//! Isolated Finance rules and model preferences.
//!
//! The SQLite current/history rows are authoritative. `rules.md` is a guarded
//! human-readable mirror that can be reconstructed from SQLite after a failed
//! filesystem replacement; these settings do not advance ledger generation.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};

use rusqlite::{params, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::finance_v2_workspace::IsolatedWorkspaceRoot;

use super::session::{
    finance_v2_write_lock, guarded_root_path, open_store, verify_session, FinanceV2Session,
};

const RULES_FILE: &str = "rules.md";
const MAX_RULES_BYTES: usize = 1024 * 1024;
const MAX_MODEL_ID_BYTES: usize = 256;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDocument {
    pub content: String,
    pub revision: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleAppendPreview {
    pub base_revision: u64,
    pub base_sha256: String,
    pub preview_content: String,
    pub append_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceAiModelDocument {
    pub model_id: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesReadRequest {
    pub session: FinanceV2Session,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesSaveRequest {
    pub session: FinanceV2Session,
    pub expected_revision: u64,
    pub expected_sha256: String,
    pub content: String,
    pub recorded_at_utc_us: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesPreviewAppendRequest {
    pub session: FinanceV2Session,
    pub expected_revision: u64,
    pub expected_sha256: String,
    pub append_text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesConfirmAppendRequest {
    pub session: FinanceV2Session,
    pub expected_revision: u64,
    pub expected_sha256: String,
    pub append_sha256: String,
    pub confirmed: bool,
    pub recorded_at_utc_us: i64,
    /// The raw append string shown in the preview. Its hash is rechecked here.
    pub append_text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesOpenFileRequest {
    pub session: FinanceV2Session,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinanceAiModelReadRequest {
    pub session: FinanceV2Session,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinanceAiModelSaveRequest {
    pub session: FinanceV2Session,
    pub expected_revision: u64,
    pub model_id: String,
    pub recorded_at_utc_us: i64,
}

#[tauri::command]
pub fn finance_v2_rules_read(
    app: tauri::AppHandle,
    request: RulesReadRequest,
) -> Result<RuleDocument, String> {
    let root = verify_session(&app, &request.session)?;
    let connection = open_store(&root)?;
    read_rules(&connection)
}

#[tauri::command]
pub fn finance_v2_rules_save(
    app: tauri::AppHandle,
    request: RulesSaveRequest,
) -> Result<RuleDocument, String> {
    check_rules_size(&request.content)?;
    let _write = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let mut connection = open_store(&root)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(store_error)?;
    let current = read_rules(&tx)?;
    check_rule_base(&current, request.expected_revision, &request.expected_sha256)?;
    let content = request.content;
    let next = RuleDocument {
        sha256: sha256(content.as_bytes()),
        content,
        revision: next_revision(current.revision)?,
    };
    store_rules_revision(&tx, &current, &next, request.recorded_at_utc_us)?;
    tx.commit().map_err(store_error)?;
    sync_rules_file(&root, &next.content)?;
    Ok(next)
}

#[tauri::command]
pub fn finance_v2_rules_preview_append(
    app: tauri::AppHandle,
    request: RulesPreviewAppendRequest,
) -> Result<RuleAppendPreview, String> {
    if request.append_text.is_empty() {
        return Err("rule_append_empty".into());
    }
    check_rules_size(&request.append_text)?;
    let root = verify_session(&app, &request.session)?;
    let connection = open_store(&root)?;
    let current = read_rules(&connection)?;
    check_rule_base(&current, request.expected_revision, &request.expected_sha256)?;
    let preview_content = append_exact(&current.content, &request.append_text)?;
    Ok(RuleAppendPreview {
        base_revision: current.revision,
        base_sha256: current.sha256,
        preview_content,
        append_sha256: sha256(request.append_text.as_bytes()),
    })
}

#[tauri::command]
pub fn finance_v2_rules_confirm_append(
    app: tauri::AppHandle,
    request: RulesConfirmAppendRequest,
) -> Result<RuleDocument, String> {
    if !request.confirmed {
        return Err("rule_append_confirmation_required".into());
    }
    if request.append_text.is_empty() {
        return Err("rule_append_empty".into());
    }
    check_rules_size(&request.append_text)?;
    if sha256(request.append_text.as_bytes()) != request.append_sha256 {
        return Err("rule_append_hash_mismatch".into());
    }
    let _write = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let mut connection = open_store(&root)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(store_error)?;
    let current = read_rules(&tx)?;
    check_rule_base(&current, request.expected_revision, &request.expected_sha256)?;
    let content = append_exact(&current.content, &request.append_text)?;
    let next = RuleDocument {
        sha256: sha256(content.as_bytes()),
        content,
        revision: next_revision(current.revision)?,
    };
    store_rules_revision(&tx, &current, &next, request.recorded_at_utc_us)?;
    tx.commit().map_err(store_error)?;
    sync_rules_file(&root, &next.content)?;
    Ok(next)
}

#[tauri::command]
pub fn finance_v2_rules_open_file(
    app: tauri::AppHandle,
    request: RulesOpenFileRequest,
) -> Result<String, String> {
    let _write = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let connection = open_store(&root)?;
    let document = read_rules(&connection)?;
    sync_rules_file(&root, &document.content)?;
    let path = guarded_root_path(&root, RULES_FILE)?;
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| "rules_path_not_unicode".into())
}

#[tauri::command]
pub fn finance_v2_ai_model_read(
    app: tauri::AppHandle,
    request: FinanceAiModelReadRequest,
) -> Result<FinanceAiModelDocument, String> {
    let root = verify_session(&app, &request.session)?;
    let connection = open_store(&root)?;
    read_model(&connection)
}

#[tauri::command]
pub fn finance_v2_ai_model_save(
    app: tauri::AppHandle,
    request: FinanceAiModelSaveRequest,
) -> Result<FinanceAiModelDocument, String> {
    validate_model_id(&request.model_id)?;
    let _write = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let mut connection = open_store(&root)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(store_error)?;
    let current = read_model(&tx)?;
    if current.revision != request.expected_revision {
        return Err("finance_ai_model_revision_conflict".into());
    }
    let revision = next_revision(current.revision)?;
    tx.execute(
        "INSERT INTO finance_v2_ai_model_history(revision, model_id, recorded_at_utc_us) VALUES (?1, ?2, ?3)",
        params![to_sql_revision(revision)?, request.model_id, request.recorded_at_utc_us],
    )
    .map_err(store_error)?;
    let changed = tx
        .execute(
            "UPDATE finance_v2_ai_model_current SET revision=?1, model_id=?2 WHERE singleton=1 AND revision=?3",
            params![to_sql_revision(revision)?, request.model_id, to_sql_revision(current.revision)?],
        )
        .map_err(store_error)?;
    if changed != 1 {
        return Err("finance_ai_model_revision_conflict".into());
    }
    tx.commit().map_err(store_error)?;
    Ok(FinanceAiModelDocument {
        model_id: Some(request.model_id),
        revision,
    })
}

fn read_rules(connection: &rusqlite::Connection) -> Result<RuleDocument, String> {
    let row = connection
        .query_row(
            "SELECT revision, content, sha256 FROM finance_v2_rules_current WHERE singleton=1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        )
        .map_err(store_error)?;
    let revision = from_sql_revision(row.0)?;
    if sha256(row.1.as_bytes()) != row.2 {
        return Err("finance_rules_current_hash_invalid".into());
    }
    check_rules_size(&row.1)?;
    Ok(RuleDocument {
        content: row.1,
        revision,
        sha256: row.2,
    })
}

fn read_model(connection: &rusqlite::Connection) -> Result<FinanceAiModelDocument, String> {
    let (revision, model_id) = connection
        .query_row(
            "SELECT revision, model_id FROM finance_v2_ai_model_current WHERE singleton=1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(store_error)?;
    let model_id = if model_id.is_empty() {
        None
    } else {
        validate_model_id(&model_id)?;
        Some(model_id)
    };
    Ok(FinanceAiModelDocument {
        model_id,
        revision: from_sql_revision(revision)?,
    })
}

fn check_rule_base(
    current: &RuleDocument,
    expected_revision: u64,
    expected_sha256: &str,
) -> Result<(), String> {
    if current.revision != expected_revision || current.sha256 != expected_sha256 {
        return Err("finance_rules_revision_conflict".into());
    }
    Ok(())
}

fn store_rules_revision(
    tx: &Transaction<'_>,
    current: &RuleDocument,
    next: &RuleDocument,
    recorded_at_utc_us: i64,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO finance_v2_rules_history(revision, content, sha256, recorded_at_utc_us) VALUES (?1, ?2, ?3, ?4)",
        params![
            to_sql_revision(next.revision)?,
            next.content,
            next.sha256,
            recorded_at_utc_us
        ],
    )
    .map_err(store_error)?;
    let changed = tx
        .execute(
            "UPDATE finance_v2_rules_current SET revision=?1, content=?2, sha256=?3 WHERE singleton=1 AND revision=?4 AND sha256=?5",
            params![
                to_sql_revision(next.revision)?,
                next.content,
                next.sha256,
                to_sql_revision(current.revision)?,
                current.sha256
            ],
        )
        .map_err(store_error)?;
    if changed != 1 {
        return Err("finance_rules_revision_conflict".into());
    }
    Ok(())
}

fn append_exact(current: &str, append_text: &str) -> Result<String, String> {
    let separator = usize::from(!current.is_empty() && !current.ends_with('\n'));
    let size = current
        .len()
        .checked_add(separator)
        .and_then(|length| length.checked_add(append_text.len()))
        .ok_or("rules_content_too_large")?;
    if size > MAX_RULES_BYTES {
        return Err("rules_content_too_large".into());
    }
    let mut combined = String::with_capacity(size);
    combined.push_str(current);
    if separator != 0 {
        combined.push('\n');
    }
    combined.push_str(append_text);
    Ok(combined)
}

fn check_rules_size(content: &str) -> Result<(), String> {
    if content.len() > MAX_RULES_BYTES {
        return Err("rules_content_too_large".into());
    }
    Ok(())
}

fn validate_model_id(model_id: &str) -> Result<(), String> {
    if model_id.is_empty()
        || model_id.len() > MAX_MODEL_ID_BYTES
        || model_id.chars().any(char::is_control)
        || model_id.trim() != model_id
    {
        return Err("finance_ai_model_id_invalid".into());
    }
    Ok(())
}

fn next_revision(revision: u64) -> Result<u64, String> {
    revision
        .checked_add(1)
        .ok_or_else(|| "settings_revision_overflow".into())
}

fn to_sql_revision(revision: u64) -> Result<i64, String> {
    i64::try_from(revision).map_err(|_| "settings_revision_overflow".into())
}

fn from_sql_revision(revision: i64) -> Result<u64, String> {
    u64::try_from(revision).map_err(|_| "settings_revision_invalid".into())
}

fn sync_rules_file(root: &IsolatedWorkspaceRoot, content: &str) -> Result<(), String> {
    let parent = root.path().to_path_buf();
    let destination = guarded_root_path(root, RULES_FILE)?;
    let temporary_relative = format!(".rules-{}.tmp", Uuid::new_v4());
    let temporary = guarded_root_path(root, &temporary_relative)?;
    let write_result = write_synced_file(&temporary, content.as_bytes());
    if write_result.is_err() {
        return Err("rules_saved_file_sync_pending".into());
    }
    if verify_rules_file(root, &temporary_relative, content.as_bytes()).is_err() {
        let _ = remove_owned_temp(root, &temporary_relative, &temporary, content.as_bytes());
        return Err("rules_saved_file_sync_pending".into());
    }
    if replace_file(&temporary, &destination).is_err() {
        let _ = remove_owned_temp(root, &temporary_relative, &temporary, content.as_bytes());
        return Err("rules_saved_file_sync_pending".into());
    }
    if verify_rules_file(root, RULES_FILE, content.as_bytes()).is_err() {
        return Err("rules_saved_file_sync_pending".into());
    }
    sync_parent_directory(&parent);
    Ok(())
}

fn verify_rules_file(
    root: &IsolatedWorkspaceRoot,
    relative: &str,
    expected: &[u8],
) -> Result<(), String> {
    let path = guarded_root_path(root, relative)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| "rules_file_missing")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("rules_file_invalid".into());
    }
    if metadata.len() as usize != expected.len() {
        return Err("rules_file_content_mismatch".into());
    }
    let actual = fs::read(path).map_err(|_| "rules_file_read_failed")?;
    if actual != expected {
        return Err("rules_file_content_mismatch".into());
    }
    Ok(())
}

fn write_synced_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "rules_temp_create_failed")?;
    file.write_all(bytes).map_err(|_| "rules_temp_write_failed")?;
    file.sync_all().map_err(|_| "rules_temp_flush_failed")?;
    Ok(())
}

fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) => {}
        Ok(_) => return Err("rules_file_target_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(windows)]
            {
                use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
                let source = windows::core::HSTRING::from(temporary.as_os_str().to_string_lossy().as_ref());
                let target = windows::core::HSTRING::from(destination.as_os_str().to_string_lossy().as_ref());
                unsafe { MoveFileExW(&source, &target, MOVEFILE_WRITE_THROUGH) }
                    .map_err(|_| "rules_file_replace_failed")?;
            }
            #[cfg(not(windows))]
            fs::rename(temporary, destination).map_err(|_| "rules_file_replace_failed")?;
            return Ok(());
        }
        Err(_) => return Err("rules_file_target_read_failed".into()),
    }

    #[cfg(windows)]
    {
        use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};
        let target = windows::core::HSTRING::from(destination.as_os_str().to_string_lossy().as_ref());
        let source = windows::core::HSTRING::from(temporary.as_os_str().to_string_lossy().as_ref());
        unsafe {
            ReplaceFileW(
                &target,
                &source,
                windows::core::PCWSTR::null(),
                REPLACE_FILE_FLAGS(0),
                None,
                None,
            )
        }
        .map_err(|_| "rules_file_replace_failed")?;
    }
    #[cfg(not(windows))]
    fs::rename(temporary, destination).map_err(|_| "rules_file_replace_failed")?;
    Ok(())
}

fn remove_owned_temp(
    root: &IsolatedWorkspaceRoot,
    relative: &str,
    path: &Path,
    expected: &[u8],
) -> Result<(), String> {
    let guarded = guarded_root_path(root, relative)?;
    if guarded != path {
        return Err("rules_temp_path_changed".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("rules_temp_file_invalid".into());
    }
    let actual = fs::read(path).map_err(|error| error.to_string())?;
    if actual != expected {
        return Err("rules_temp_file_changed".into());
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn store_error(error: impl std::fmt::Debug) -> String {
    format!("{error:?}")
}

fn sync_parent_directory(path: &Path) {
    #[cfg(unix)]
    if let Ok(directory) = File::open(path) {
        let _ = directory.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x0400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}
