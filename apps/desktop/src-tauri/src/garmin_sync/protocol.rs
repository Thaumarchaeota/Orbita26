//! Length-bounded control frames for the one-unit Python adapter.
//! Asset bytes use a Rust-created staging file and never enter this JSON frame.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_CONTROL_FRAME: usize = 1024 * 1024;
const MAX_STDERR_RETAINED: usize = 16 * 1024;
const UNIT_TIMEOUT: Duration = Duration::from_secs(90);
const HEADER_LEN: usize = 36; // u32 big-endian payload length + SHA-256
pub const UNIT_KINDS: &[&str] = &[
    "fetch_daily_class", "discover_activity_list", "fetch_activity_summary", "fetch_activity_detail", "fetch_activity_original",
];
pub const OUTCOMES: &[&str] = &[
    "complete", "no_data", "empty_unverified", "incomplete", "retryable_failure",
    "terminal_failure", "rate_limited", "token_invalid", "cancelled",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitRequest {
    pub protocol_version: u32,
    pub request_id: String,
    pub job_id: String,
    pub work_item_id: String,
    pub unit_kind: String,
    pub data_dir_key: String,
    pub cancellation_generation: u64,
    pub target: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staging_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitResponse {
    pub protocol_version: u32,
    pub request_id: String,
    pub job_id: String,
    pub work_item_id: String,
    pub unit_kind: String,
    pub data_dir_key: String,
    pub cancellation_generation: u64,
    pub outcome: String,
    pub payload: Option<serde_json::Value>,
    pub content_hash: Option<String>,
    pub asset_length: Option<u64>,
    pub asset_metadata: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_entries: Vec<serde_json::Value>,
}

fn checksum(bytes: &[u8]) -> [u8; 32] { Sha256::digest(bytes).into() }

pub fn write_frame(mut out: impl Write, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_CONTROL_FRAME { return Err("control frame length is invalid".into()); }
    out.write_all(&(bytes.len() as u32).to_be_bytes()).map_err(|e| e.to_string())?;
    out.write_all(&checksum(&bytes)).map_err(|e| e.to_string())?;
    out.write_all(&bytes).map_err(|e| e.to_string())
}

pub fn read_frame<T: for<'de> Deserialize<'de>>(mut input: impl Read) -> Result<T, String> {
    let mut header = [0u8; HEADER_LEN];
    input.read_exact(&mut header).map_err(|e| format!("invalid frame header: {e}"))?;
    let len = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
    if len == 0 || len > MAX_CONTROL_FRAME { return Err("control frame exceeds limit".into()); }
    let mut body = vec![0u8; len];
    input.read_exact(&mut body).map_err(|e| format!("truncated control frame: {e}"))?;
    let mut trailing = [0u8; 1];
    if input.read(&mut trailing).map_err(|e| e.to_string())? != 0 { return Err("duplicate or trailing frame bytes".into()); }
    if checksum(&body).as_slice() != &header[4..] { return Err("control frame checksum mismatch".into()); }
    serde_json::from_slice(&body).map_err(|e| format!("malformed control JSON: {e}"))
}

pub fn validate_pair(request: &UnitRequest, response: &UnitResponse, expected_key: &str) -> Result<(), String> {
    if request.protocol_version != PROTOCOL_VERSION || response.protocol_version != PROTOCOL_VERSION { return Err("unsupported protocolVersion".into()); }
    if !UNIT_KINDS.contains(&request.unit_kind.as_str()) || request.unit_kind != response.unit_kind { return Err("out-of-order unitKind".into()); }
    if !OUTCOMES.contains(&response.outcome.as_str()) { return Err("unknown unit outcome".into()); }
    if request.request_id != response.request_id || request.job_id != response.job_id || request.work_item_id != response.work_item_id { return Err("out-of-order or duplicate request response".into()); }
    if request.data_dir_key != expected_key || response.data_dir_key != expected_key { return Err("dataDirKey changed".into()); }
    if request.cancellation_generation != response.cancellation_generation { return Err("stale cancellation generation".into()); }
    if request.unit_kind == "fetch_activity_original" && (response.payload.is_some() || response.outcome == "complete" && (response.asset_length.is_none() || response.content_hash.is_none() || response.asset_metadata.is_none())) { return Err("Original must use the staging asset channel".into()); }
    Ok(())
}

/// Starts one short-lived Python process for exactly one control frame. Stdout is parsed
/// as a single bounded frame; stderr is drained concurrently while retaining only a prefix.
pub fn run_python_unit(command: &mut Command, request: &UnitRequest) -> Result<UnitResponse, String> {
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("could not start Garmin unit worker: {e}"))?;
    let input = child.stdin.take().ok_or("Garmin unit worker stdin unavailable")?;
    let output = child.stdout.take().ok_or("Garmin unit worker stdout unavailable")?;
    let error_output = child.stderr.take().ok_or("Garmin unit worker stderr unavailable")?;

    let stderr_thread = std::thread::spawn(move || {
        let mut kept = Vec::with_capacity(MAX_STDERR_RETAINED);
        let mut buffer = [0u8; 4096];
        let mut stream = error_output;
        loop {
            let count = match stream.read(&mut buffer) { Ok(0) | Err(_) => break, Ok(n) => n };
            let remaining = MAX_STDERR_RETAINED.saturating_sub(kept.len());
            kept.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        kept
    });
    let (sender, receiver) = mpsc::channel();
    let stdout_thread = std::thread::spawn(move || {
        let result = read_frame::<UnitResponse>(output);
        let _ = sender.send(result);
    });

    let mut input = input;
    let write_result = write_frame(&mut input, request);
    drop(input); // EOF tells the worker this process has exactly one request.
    if let Err(error) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let response = match receiver.recv_timeout(UNIT_TIMEOUT) {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Garmin unit worker timed out".into());
        }
    };
    let status = child.wait().map_err(|e| format!("could not wait for Garmin unit worker: {e}"))?;
    let _ = stdout_thread.join();
    let stderr = stderr_thread.join().unwrap_or_default();
    // Python uses a nonzero exit for framed provider failures. The validated outcome is
    // authoritative; malformed or unframed failures were rejected while reading stdout.
    let _ = status;
    let _ = String::from_utf8_lossy(&stderr);
    validate_pair(request, &response, &request.data_dir_key)?;
    Ok(response)
}

fn dispatch_when_open<T>(gate_open: bool, dispatch: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    if !gate_open { return Err("Garmin gate closed before dispatch".into()); }
    dispatch()
}

fn validate_returned_unit(request: &UnitRequest, response: &UnitResponse, expected_key: &str, active_key: &str, gate_open: bool) -> Result<(), String> {
    validate_pair(request, response, expected_key)?;
    if active_key != expected_key { return Err("dataDirKey changed after dispatch".into()); }
    if !gate_open { return Err("Garmin gate closed after dispatch".into()); }
    Ok(())
}

/// The only supported host boundary for unit work. The returned guard stays alive through
/// the caller's one-unit apply, keeping requests serialized across the commit boundary.
pub fn guarded_dispatch(
    data_dir: &str,
    request: &UnitRequest,
    active_data_dir: impl Fn() -> Result<String, String>,
    dispatch: impl FnOnce(&UnitRequest) -> Result<UnitResponse, String>,
) -> Result<(UnitResponse, super::lane::RequestGuard), String> {
    let initial_dir = active_data_dir()?;
    if initial_dir != data_dir { return Err("active dataDir changed before dispatch".into()); }
    let key_before = super::data_dir_key(&initial_dir);
    if key_before != request.data_dir_key { return Err("dataDirKey changed before dispatch".into()); }
    let request_guard = super::acquire_legacy_request().map_err(|(_, message)| message.to_string())?;
    super::require_gate_open().map_err(|e| e.message)?;
    let response = dispatch_when_open(super::gate::process_gate_is_open(), || dispatch(request))?;
    if response.outcome == "rate_limited" {
        super::legacy_observe_429(None);
    }
    let returned_dir = active_data_dir()?;
    if response.outcome == "rate_limited" {
        // A 429 closes the global gate by design; preserve the framed outcome so the
        // coordinator can checkpoint the gap and stop the remaining daily units.
        validate_pair(request, &response, &key_before)?;
        if super::data_dir_key(&returned_dir) != key_before { return Err("dataDirKey changed after 429 response".into()); }
    } else {
        validate_returned_unit(request, &response, &key_before, &super::data_dir_key(&returned_dir), super::gate::process_gate_is_open())?;
    }
    Ok((response, request_guard))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: &str) -> UnitRequest {
        UnitRequest { protocol_version: 1, request_id: "r1".into(), job_id: "j1".into(),
            work_item_id: "w1".into(), unit_kind: kind.into(), data_dir_key: "d1".into(),
            cancellation_generation: 7, target: serde_json::json!({"localDate":"2026-10-13"}), staging_path: None }
    }
    fn response(req: &UnitRequest) -> UnitResponse {
        UnitResponse { protocol_version: 1, request_id: req.request_id.clone(), job_id: req.job_id.clone(),
            work_item_id: req.work_item_id.clone(), unit_kind: req.unit_kind.clone(), data_dir_key: req.data_dir_key.clone(),
            cancellation_generation: req.cancellation_generation, outcome: "complete".into(), payload: Some(serde_json::json!({"ok":true})),
            content_hash: None, asset_length: None, asset_metadata: None, related_entries: Vec::new() }
    }

    #[test]
    fn rejects_frames_over_limit_and_duplicate_trailing_frames() {
        let mut oversized = Vec::from((MAX_CONTROL_FRAME as u32 + 1).to_be_bytes());
        oversized.extend_from_slice(&[0u8; 32]);
        assert!(read_frame::<UnitRequest>(oversized.as_slice()).unwrap_err().contains("exceeds"));
        let mut encoded = Vec::new();
        write_frame(&mut encoded, &request("fetch_daily_class")).unwrap();
        let duplicate = [encoded.clone(), encoded].concat();
        assert!(read_frame::<UnitRequest>(duplicate.as_slice()).unwrap_err().contains("trailing"));
    }

    #[test]
    fn rejects_out_of_order_and_changed_data_dir_responses() {
        let req = request("fetch_activity_summary");
        let mut out = response(&req);
        out.unit_kind = "fetch_daily_class".into();
        assert!(validate_pair(&req, &out, "d1").unwrap_err().contains("out-of-order"));
        let mut out = response(&req);
        assert!(validate_pair(&req, &out, "other-dir").unwrap_err().contains("dataDirKey"));
        out.request_id = "duplicate-or-old".into();
        assert!(validate_pair(&req, &out, "d1").unwrap_err().contains("out-of-order"));
    }

    #[test]
    fn original_payload_is_rejected_and_asset_metadata_is_required() {
        let req = request("fetch_activity_original");
        let mut out = response(&req);
        assert!(validate_pair(&req, &out, "d1").unwrap_err().contains("staging asset"));
        out.payload = None;
        out.content_hash = Some("hash".into());
        out.asset_length = Some(11);
        out.asset_metadata = Some(serde_json::json!({"mediaType":"application/zip"}));
        assert!(validate_pair(&req, &out, "d1").is_ok());
    }

    #[test]
    fn closed_gate_stops_before_dispatch_and_after_rate_limit_response() {
        let req = request("fetch_daily_class");
        let mut called = false;
        let before = dispatch_when_open(false, || { called = true; Ok(()) });
        assert!(before.unwrap_err().contains("before dispatch"));
        assert!(!called);

        let mut out = response(&req);
        out.outcome = "rate_limited".into();
        let after = validate_returned_unit(&req, &out, "d1", "d1", false);
        assert!(after.unwrap_err().contains("after dispatch"));
    }
}
