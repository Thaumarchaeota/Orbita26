use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct ZoteroItem {
    pub id: i64,
    pub key: String,
    pub item_type: String,
    pub title: String,
    pub date_modified: String,
    pub note_path: Option<String>,
}

fn is_zotero_key(name: &str) -> bool {
    name.len() == 8 && name.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn load_note_index(article_note_dir: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let dir = Path::new(article_note_dir);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return map;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_zotero_key(stem) {
            continue;
        }
        map.insert(stem.to_ascii_uppercase(), path.to_string_lossy().into_owned());
    }
    map
}

fn load_parent_note_keys(conn: &Connection) -> Result<HashMap<i64, Vec<String>>, String> {
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT ino.parentItemID, n.key
             FROM itemNotes ino
             JOIN items n ON ino.itemID = n.itemID",
        )
        .map_err(|e| format!("笔记关联查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("笔记关联读取失败: {e}"))?;
    for row in rows {
        let (parent_id, note_key) = row.map_err(|e| format!("笔记关联解析失败: {e}"))?;
        map.entry(parent_id).or_default().push(note_key);
    }
    Ok(map)
}

fn note_path_for_article(
    parent_item_id: i64,
    parent_note_keys: &HashMap<i64, Vec<String>>,
    note_index: &HashMap<String, String>,
) -> Option<String> {
    let keys = parent_note_keys.get(&parent_item_id)?;
    for key in keys {
        if let Some(path) = note_index.get(&key.to_ascii_uppercase()) {
            return Some(path.clone());
        }
    }
    None
}

pub fn list_recent_items(
    zotero_data_dir: &str,
    article_note_dir: &str,
    limit: u32,
) -> Result<Vec<ZoteroItem>, String> {
    let path = PathBuf::from(zotero_data_dir).join("zotero.sqlite");
    if !path.exists() {
        return Err(format!("未找到数据库: {}", path.display()));
    }
    let note_index = load_note_index(article_note_dir);
    let uri = format!(
        "file:{}?mode=ro&immutable=1",
        path.display().to_string().replace('\\', "/")
    );
    let conn = Connection::open_with_flags(&uri, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打开数据库失败: {e}"))?;
    let parent_note_keys = load_parent_note_keys(&conn)?;

    let pool = limit;
    let mut stmt = conn
        .prepare(
            "SELECT i.itemID, i.key, it.typeName, COALESCE(idv.value, ''), i.dateModified
             FROM items i
             JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
             LEFT JOIN itemData id ON i.itemID = id.itemID AND id.fieldID = 1
             LEFT JOIN itemDataValues idv ON id.valueID = idv.valueID
             WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
               AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
             ORDER BY i.dateModified DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("查询准备失败: {e}"))?;

    let items: Vec<ZoteroItem> = stmt
        .query_map([pool], |row| {
            let item_id: i64 = row.get(0)?;
            let key: String = row.get(1)?;
            let note_path = note_path_for_article(item_id, &parent_note_keys, &note_index);
            Ok(ZoteroItem {
                id: item_id,
                key,
                item_type: row.get(2)?,
                title: row.get(3)?,
                date_modified: row.get(4)?,
                note_path,
            })
        })
        .map_err(|e| format!("查询失败: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取结果失败: {e}"))?;

    Ok(items)
}
