use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySnapshot {
    pub id: String,
    pub revision: i64,
    pub kind: String,
    pub title: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub mood: Option<String>,
    pub text: Option<String>,
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    pub has_detail: bool,
    pub detail_file_id: Option<String>,
    pub detail_sha256: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryResponse {
    pub entry: EntrySnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntriesListResponse {
    pub entries: Vec<EntrySnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub started_at: String,
    pub text: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub mood: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    pub id: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub title: Option<Option<String>>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub ended_at: Option<Option<String>>,
    #[serde(default)]
    pub mood: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentRequest {
    pub title: String,
    pub started_at: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub mood: Option<String>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub markdown: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub id: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<Option<String>>,
    #[serde(default)]
    pub mood: Option<Option<String>>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub ended_at: Option<Option<String>>,
    #[serde(default)]
    pub markdown: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertNoteToDocumentRequest {
    pub id: String,
    pub expected_revision: i64,
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub mood: Option<Option<String>>,
    #[serde(default)]
    pub ended_at: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntryRequest {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListEntriesQuery {
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default)]
    pub limit: Option<i64>,
}
