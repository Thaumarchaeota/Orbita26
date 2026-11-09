//! Invocation-only normalized results, never a second source store (workflow §20).
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;
use serde_json::Value;
use super::protocol::{UnitRequest, UnitResponse, PROTOCOL_VERSION};

pub(crate) const MAX_REUSE_ENTRIES: usize = 300;
pub(crate) const MAX_REUSE_BYTES: usize = 512 * 1024;
pub(crate) const MAX_REUSE_ENTRY_BYTES: usize = 256 * 1024;
pub(crate) const MAX_SLEEP_REUSE_ENTRIES: usize = 7;
pub(crate) const MAX_SLEEP_REUSE_BYTES: usize = 256 * 1024;
static AUTH_EPOCH: AtomicU64 = AtomicU64::new(0);

pub(crate) fn advance_auth_epoch() { AUTH_EPOCH.fetch_add(1, Ordering::SeqCst); }

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ReuseContext {
    pub job_id: String,
    pub data_dir_key: String,
    pub token_dir: PathBuf,
    pub gate_generation: i64,
    pub auth_epoch: u64,
    pub credential_files: Vec<(String, u64, SystemTime, SystemTime)>,
}

/// Called only while holding the request lane. Inspect metadata, never token bytes.
/// Unknown files are included; only the two known non-credential diagnostics are excluded.
pub(crate) fn capture_context(job_id: &str, key: &str, token_dir: &Path) -> Option<ReuseContext> {
    let gate = super::gate::process_gate_snapshot();
    if gate.state != "open" { return None; }
    let root = token_dir.canonicalize().ok()?;
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&root).ok()? {
        let entry = entry.ok()?;
        let name = entry.file_name().into_string().ok()?;
        if matches!(name.as_str(), "garmin_route.json" | "garmin_rate_limit.json") { continue; }
        let meta = std::fs::symlink_metadata(entry.path()).ok()?;
        if !meta.is_file() || meta.file_type().is_symlink() || files.len() >= 64 { return None; }
        files.push((name, meta.len(), meta.modified().ok()?, meta.created().ok()?));
    }
    if !files.iter().any(|(name, len, _, _)| name == "garmin_tokens.json" && *len > 2) { return None; }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Some(ReuseContext { job_id:job_id.into(), data_dir_key:key.into(), token_dir:root,
        gate_generation:gate.generation, auth_epoch:AUTH_EPOCH.load(Ordering::SeqCst), credential_files:files })
}

#[derive(Default)]
pub(crate) struct RunFetchReuse {
    context: Option<ReuseContext>,
    entries: HashMap<(String, String, String), (Value, usize)>,
    bytes: usize,
    sleep_entries: usize,
    sleep_bytes: usize,
}

fn identity(entry: &Value) -> Option<(String, String, String)> {
    let class = entry.get("classId")?.as_str()?;
    if !matches!(class, "sleep_night" | "nap" | "activity")
        || entry.get("completeness")?.as_str()? != "complete"
        || entry.get("parserVersion")?.as_u64()? != 2
        || !entry.get("payload")?.is_object()
        { return None; }
    let hash = entry.get("contentHash")?.as_str()?;
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return None; }
    let date = entry.get("localDate")?.as_str()?;
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    if parsed.format("%Y-%m-%d").to_string() != date { return None; }
    let external = if class == "activity" {
        entry.get("externalId")?.as_str()?.to_string()
    } else { String::new() };
    if class == "activity" && (external.trim().is_empty() || external.contains('|')) { return None; }
    Some((date.into(), class.into(), external))
}

impl RunFetchReuse {
    pub(crate) fn clear(&mut self) {
        self.entries.clear(); self.bytes = 0; self.sleep_entries = 0; self.sleep_bytes = 0; self.context = None;
    }
    pub(crate) fn observe_context(&mut self, context: Option<ReuseContext>) {
        if context.is_none() || self.context != context { self.clear(); self.context = context; }
    }
    pub(crate) fn insert(&mut self, context: &ReuseContext, entry: Value) -> bool {
        self.observe_context(Some(context.clone()));
        let Some(id) = identity(&entry) else { return false; };
        let sleep = matches!(id.1.as_str(), "sleep_night" | "nap");
        let Ok(bytes) = serde_json::to_vec(&entry).map(|v| v.len()) else { return false; };
        if bytes > MAX_REUSE_ENTRY_BYTES || self.entries.contains_key(&id)
            || self.entries.len() >= MAX_REUSE_ENTRIES || self.bytes + bytes > MAX_REUSE_BYTES
            || sleep && (self.sleep_entries >= MAX_SLEEP_REUSE_ENTRIES || self.sleep_bytes + bytes > MAX_SLEEP_REUSE_BYTES) { return false; }
        self.bytes += bytes;
        if sleep { self.sleep_entries += 1; self.sleep_bytes += bytes; }
        self.entries.insert(id, (entry, bytes));
        true
    }
    /// Reject the entire optional snapshot on any repeated ID, even identical duplicates.
    /// Base discovery checkpoint/identity-conflict semantics remain owned by the host.
    pub(crate) fn ingest_discovery(&mut self, context: &ReuseContext, response: &UnitResponse) -> bool {
        self.observe_context(Some(context.clone()));
        if response.unit_kind != "discover_activity_list" || response.outcome != "complete"
            || response.job_id != context.job_id || response.data_dir_key != context.data_dir_key { return false; }
        let Some(payload) = response.payload.as_ref() else { return false; };
        let Some(evidence) = payload.get("evidence") else { return false; };
        if evidence.get("complete").and_then(Value::as_bool) != Some(true)
            || evidence.get("duplicateActivityIds").and_then(Value::as_bool) == Some(true) { return false; }
        let Some(list) = payload.get("activities").and_then(Value::as_array) else { return false; };
        let mut seen = std::collections::HashSet::new();
        for row in list {
            let Some(id) = row.get("externalId").and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty() && !id.contains('|')) else { return false; };
            if !seen.insert(id) { return false; }
        }
        for row in list {
            if let Some(entry) = row.get("normalizedEntry") {
                if entry.get("classId").and_then(Value::as_str) == Some("activity")
                    && entry.get("externalId") == row.get("externalId") && entry.get("localDate") == row.get("localDate") {
                    self.insert(context, entry.clone());
                }
            }
        }
        true
    }
    pub(crate) fn take_for(&mut self, context: &ReuseContext, request: &UnitRequest) -> Option<UnitResponse> {
        self.observe_context(Some(context.clone()));
        if request.job_id != context.job_id || request.data_dir_key != context.data_dir_key { self.clear(); return None; }
        let date = request.target.get("localDate")?.as_str()?;
        let (class, id) = match request.unit_kind.as_str() {
            "fetch_daily_class" => (request.target.get("classId")?.as_str()?, ""),
            "fetch_activity_summary" => ("activity", request.target.get("externalId")?.as_str()?),
            _ => return None,
        };
        let (entry, bytes) = self.entries.remove(&(date.into(), class.into(), id.into()))?;
        self.bytes -= bytes;
        if matches!(class, "sleep_night" | "nap") { self.sleep_entries -= 1; self.sleep_bytes -= bytes; }
        Some(UnitResponse { protocol_version:PROTOCOL_VERSION, request_id:request.request_id.clone(),
            job_id:request.job_id.clone(), work_item_id:request.work_item_id.clone(), unit_kind:request.unit_kind.clone(),
            data_dir_key:request.data_dir_key.clone(), cancellation_generation:request.cancellation_generation,
            outcome:"complete".into(), content_hash:entry.get("contentHash").and_then(Value::as_str).map(str::to_string),
            payload:Some(entry), asset_length:None, asset_metadata:None, related_entries:Vec::new() })
    }
}
