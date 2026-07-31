use serde::Serialize;

use std::fs;

use std::path::{Path, PathBuf};

use std::time::UNIX_EPOCH;



#[derive(Serialize)]

pub struct ObsidianNote {

    pub path: String,

    pub name: String,

    pub modified: u64,

}



fn mtime_secs(path: &Path) -> u64 {

    fs::metadata(path)

        .and_then(|m| m.modified())

        .ok()

        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())

        .map(|d| d.as_secs())

        .unwrap_or(0)

}



fn should_skip_dir(name: &str) -> bool {

    name == ".obsidian" || name.starts_with('.')

}



fn note_name(root: &Path, path: &Path) -> String {

    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {

        let stem = stem.trim();

        if !stem.is_empty() {

            return stem.to_string();

        }

    }

    let rel = path

        .strip_prefix(root)

        .unwrap_or(path)

        .to_string_lossy()

        .replace('\\', "/");

    rel.rsplit('/')

        .next()

        .unwrap_or("")

        .trim_end_matches(".md")

        .to_string()

}



fn walk_md(root: &Path, dir: &Path, out: &mut Vec<ObsidianNote>) -> Result<(), String> {

    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;

    for entry in entries {

        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;

        let path = entry.path();

        if path.is_dir() {

            let name = path

                .file_name()

                .and_then(|s| s.to_str())

                .unwrap_or("");

            if should_skip_dir(name) {

                continue;

            }

            walk_md(root, &path, out)?;

            continue;

        }

        if path.extension().and_then(|s| s.to_str()) != Some("md") {

            continue;

        }

        out.push(ObsidianNote {

            path: path.to_string_lossy().into_owned(),

            name: note_name(root, &path),

            modified: mtime_secs(&path),

        });

    }

    Ok(())

}



pub fn list_notes(vault_dir: &str, limit: u32) -> Result<Vec<ObsidianNote>, String> {

    if vault_dir.is_empty() {

        return Err("请先在设置中配置 Obsidian 库目录".into());

    }

    let root = PathBuf::from(vault_dir);

    if !root.is_dir() {

        return Err(format!("目录不存在: {vault_dir}"));

    }

    let mut notes = Vec::new();

    walk_md(&root, &root, &mut notes)?;

    notes.sort_by(|a, b| b.modified.cmp(&a.modified));

    notes.truncate(limit as usize);

    Ok(notes)

}

