use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

use crate::productivity_db::coordinator::{archive_root, with_read};

use super::error::{JournalError, JournalResult};
use super::repository;

fn canonical_uuid(value: &str) -> Option<String> {
    let parsed = uuid::Uuid::parse_str(value).ok()?;
    let canonical = parsed.to_string();
    (canonical == value).then_some(canonical)
}

fn require_canonical_uuid(value: &str, label: &str) -> JournalResult<String> {
    canonical_uuid(value).ok_or_else(|| {
        JournalError::detail_prepare_failed(format!("{label} must be a canonical UUID"))
    })
}

pub fn detail_dir(data_dir: &str, entry_id: &str) -> JournalResult<PathBuf> {
    let entry_component = require_canonical_uuid(entry_id, "entry id")?;
    Ok(archive_root(data_dir)
        .join("journal-details")
        .join(entry_component))
}

pub fn detail_file_path(
    data_dir: &str,
    entry_id: &str,
    version_id: &str,
) -> JournalResult<PathBuf> {
    let version_component = require_canonical_uuid(version_id, "detail version id")?;
    Ok(detail_dir(data_dir, entry_id)?.join(format!("{version_component}.md")))
}

pub fn sha256_hex(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

fn map_io_err(e: std::io::Error, msg: impl Into<String>) -> JournalError {
    JournalError::detail_prepare_failed(format!("{}: {e}", msg.into()))
}

pub fn prepare_detail_version(
    data_dir: &str,
    entry_id: &str,
    markdown: &str,
) -> JournalResult<(String, String)> {
    let entry_id = require_canonical_uuid(entry_id, "entry id")?;
    let version_id = uuid::Uuid::new_v4().to_string();
    let dir = detail_dir(data_dir, &entry_id)?;
    fs::create_dir_all(&dir).map_err(|e| map_io_err(e, "create detail directory"))?;

    let tmp_path = dir.join(format!(".tmp-{version_id}.md"));
    let final_path = detail_file_path(data_dir, &entry_id, &version_id)?;
    let content = markdown.as_bytes();
    let hash = sha256_hex(content);

    let write_result = (|| {
        let mut file = File::create(&tmp_path).map_err(|e| map_io_err(e, "create detail temp file"))?;
        file.write_all(content)
            .map_err(|e| map_io_err(e, "write detail temp file"))?;
        file.sync_all()
            .map_err(|e| map_io_err(e, "sync detail temp file"))?;
        fs::rename(&tmp_path, &final_path)
            .map_err(|e| map_io_err(e, "commit detail version file"))?;
        Ok::<(), JournalError>(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    Ok((version_id, hash))
}

fn read_detail_bytes(data_dir: &str, entry_id: &str, version_id: &str) -> JournalResult<Vec<u8>> {
    let path = detail_file_path(data_dir, entry_id, version_id)?;
    if !path.is_file() {
        return Err(JournalError::detail_version_mismatch(format!(
            "detail file missing for version {version_id}"
        )));
    }
    fs::read(&path).map_err(|e| {
        JournalError::detail_version_mismatch(format!("detail file unreadable: {e}"))
    })
}

pub fn verify_detail_hash(
    data_dir: &str,
    entry_id: &str,
    version_id: &str,
    expected_sha256: &str,
) -> JournalResult<()> {
    let content = read_detail_bytes(data_dir, entry_id, version_id)?;
    let hash = sha256_hex(&content);
    if hash != expected_sha256 {
        return Err(JournalError::detail_version_mismatch(
            "detail sha256 mismatch",
        ));
    }
    Ok(())
}

pub fn load_detail_markdown(
    data_dir: &str,
    entry_id: &str,
    version_id: &str,
    expected_sha256: &str,
) -> JournalResult<String> {
    let content = read_detail_bytes(data_dir, entry_id, version_id)?;
    let hash = sha256_hex(&content);
    if hash != expected_sha256 {
        return Err(JournalError::detail_version_mismatch(
            "detail sha256 mismatch",
        ));
    }
    String::from_utf8(content).map_err(|e| {
        JournalError::detail_version_mismatch(format!("detail file is not valid UTF-8: {e}"))
    })
}

pub fn remove_prepared_detail_version(data_dir: &str, entry_id: &str, version_id: &str) {
    if require_canonical_uuid(entry_id, "entry id").is_err()
        || require_canonical_uuid(version_id, "detail version id").is_err()
    {
        return;
    }
    // Version ids are private to the request that prepared them. Check the commit result
    // before unlinking so an ambiguous SQLite failure can never remove a referenced file.
    // If the Archive cannot be read, preserve the file for recovery.
    // See docs/specs/journal-local-commands.proposed.md, "Detail 一致版本与崩溃恢复".
    let referenced = with_read(data_dir, |conn| match conn {
        None => Ok(false),
        Some(conn) => Ok(repository::collect_detail_file_ids(conn)?.contains(version_id)),
    });
    if referenced.unwrap_or(true) {
        return;
    }

    let Ok(path) = detail_file_path(data_dir, entry_id, version_id) else {
        return;
    };
    if let Err(e) = fs::remove_file(&path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            let _ = (&path, e);
        }
    }
}

pub fn cleanup_unreferenced_temps(data_dir: &str) -> JournalResult<u32> {
    // A directory scan cannot distinguish a committed version from a file another
    // request has prepared but not pointed to yet. Keep this exported compatibility
    // entry point inert; request rollback removes only its own version id.
    // See docs/specs/journal-local-commands.proposed.md, "Detail 一致版本与崩溃恢复".
    let _ = data_dir;
    Ok(0)
}
