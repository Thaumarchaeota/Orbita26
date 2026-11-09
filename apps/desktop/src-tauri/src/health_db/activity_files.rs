use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use zip::read::ZipArchive;

use super::error::{HealthError, HealthResult};

pub const ACTIVITY_ASSETS_DIR: &str = "archive/activity-assets";

pub fn activity_assets_root(data_dir: &str, activity_id: &str) -> PathBuf {
    PathBuf::from(data_dir)
        .join(ACTIVITY_ASSETS_DIR)
        .join(activity_id)
}

pub fn kind_filename(kind: &str) -> Option<&'static str> {
    match kind {
        "summary" => Some("summary.json"),
        "activity_full" => Some("activity.json"),
        "details" => Some("details.json"),
        "splits" => Some("splits.json"),
        "split_summaries" => Some("split_summaries.json"),
        "typed_splits" => Some("typed_splits.json"),
        "heart_rate_zones" => Some("heart_rate_zones.json"),
        "power_zones" => Some("power_zones.json"),
        "exercise_sets" => Some("exercise_sets.json"),
        "weather" => Some("weather.json"),
        "original_zip" => Some("original.zip"),
        _ => None,
    }
}

pub fn immutable_asset_filename(kind: &str, version_id: &str) -> HealthResult<String> {
    let base = kind_filename(kind).ok_or_else(|| {
        HealthError::invalid_patch(format!("unknown activity asset kind: {kind}"))
    })?;
    let ext = base
        .rsplit_once('.')
        .map(|(_, extension)| format!(".{extension}"))
        .unwrap_or_default();
    Ok(format!("{kind}-{version_id}{ext}"))
}

pub fn relative_asset_path(activity_id: &str, filename: &str) -> String {
    format!("{ACTIVITY_ASSETS_DIR}/{activity_id}/{filename}")
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn write_asset_atomic(
    data_dir: &str,
    activity_id: &str,
    kind: &str,
    bytes: &[u8],
) -> HealthResult<(String, String)> {
    kind_filename(kind).ok_or_else(|| {
        HealthError::invalid_patch(format!("unknown activity asset kind: {kind}"))
    })?;
    let version_id = uuid::Uuid::new_v4().to_string();
    let filename = immutable_asset_filename(kind, &version_id)?;
    let dir = activity_assets_root(data_dir, activity_id);
    fs::create_dir_all(&dir).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let final_path = dir.join(&filename);
    let temp_path = dir.join(format!(".tmp-{filename}"));
    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        file.write_all(bytes)
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
        file.sync_all()
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    }
    fs::rename(&temp_path, &final_path).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let sha256 = sha256_hex(bytes);
    Ok((relative_asset_path(activity_id, &filename), sha256))
}

pub fn read_asset_bytes(data_dir: &str, relative_path: &str) -> HealthResult<Vec<u8>> {
    let path = PathBuf::from(data_dir).join(relative_path);
    fs::read(&path).map_err(|e| HealthError::root_not_found(format!("asset not found: {e}")))
}

pub fn export_fit_from_zip(zip_path: &Path, output_path: &Path) -> HealthResult<()> {
    let file = fs::File::open(zip_path).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut fit_name: Option<String> = None;
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?
            .name()
            .to_string();
        let lower = name.to_ascii_lowercase();
        if lower.ends_with("_activity.fit") || lower.ends_with(".fit") {
            fit_name = Some(name);
            break;
        }
    }
    let fit_name = fit_name.ok_or_else(|| {
        HealthError::archive_lifecycle("no .fit member found in original zip")
    })?;
    let mut entry = archive
        .by_name(&fit_name)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    }
    let temp = output_path.with_extension("fit.tmp");
    fs::write(&temp, &bytes).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    fs::rename(&temp, output_path).map_err(|e| HealthError::archive_lifecycle(e.to_string()))?;
    Ok(())
}
