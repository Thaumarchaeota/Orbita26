use crate::data::get_data_dir;
use crate::journal_archive_db;

macro_rules! journal_archive_cmd {
    ($name:ident, $req:ty, $ret:ty, |$root:ident, $parsed:ident| $body:expr) => {
        #[tauri::command]
        pub fn $name(app: tauri::AppHandle, req: serde_json::Value) -> Result<$ret, String> {
            let $root = get_data_dir(&app)?;
            let $parsed: $req = serde_json::from_value(req)
                .map_err(|e| format!("invalid request: {e}"))?;
            $body
        }
    };
}

journal_archive_cmd!(journal_archive_create_note, journal_archive_db::CreateNoteRequest, journal_archive_db::EntryResponse, |root, req| {
    journal_archive_db::create_note(&root, req).map_err(String::from)
});

journal_archive_cmd!(journal_archive_update_note, journal_archive_db::UpdateNoteRequest, journal_archive_db::EntryResponse, |root, req| {
    journal_archive_db::update_note(&root, req).map_err(String::from)
});

journal_archive_cmd!(journal_archive_create_document, journal_archive_db::CreateDocumentRequest, journal_archive_db::EntryResponse, |root, req| {
    journal_archive_db::create_document(&root, req).map_err(String::from)
});

journal_archive_cmd!(journal_archive_save_document, journal_archive_db::SaveDocumentRequest, journal_archive_db::EntryResponse, |root, req| {
    journal_archive_db::save_document(&root, req).map_err(String::from)
});

journal_archive_cmd!(journal_archive_convert_note_to_document, journal_archive_db::ConvertNoteToDocumentRequest, journal_archive_db::EntryResponse, |root, req| {
    journal_archive_db::convert_note_to_document(&root, req).map_err(String::from)
});

journal_archive_cmd!(journal_archive_delete_entry, journal_archive_db::DeleteEntryRequest, journal_archive_db::EntryResponse, |root, req| {
    journal_archive_db::delete_entry(&root, req).map_err(String::from)
});

#[tauri::command]
pub fn journal_archive_get_entry(
    app: tauri::AppHandle,
    req: serde_json::Value,
) -> Result<journal_archive_db::EntryResponse, String> {
    let root = get_data_dir(&app)?;
    let id = req
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "id required".to_string())?;
    journal_archive_db::get_entry(&root, id).map_err(String::from)
}

journal_archive_cmd!(journal_archive_list_entries, journal_archive_db::ListEntriesQuery, journal_archive_db::EntriesListResponse, |root, req| {
    journal_archive_db::list_entries(&root, req).map_err(String::from)
});

journal_archive_cmd!(journal_archive_apply_ai_batch, journal_archive_db::ApplyJournalAiBatchRequest, journal_archive_db::ApplyJournalAiBatchResponse, |root, req| {
    if let Some(expected) = &req.expected_data_dir {
        if expected != &root {
            return Err("数据目录已切换，操作已取消".to_string());
        }
    }
    journal_archive_db::apply_journal_ai_batch(&root, req).map_err(String::from)
});
