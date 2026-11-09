use super::AgentTool;
use crate::health_db::{self, ApplyHealthAiBatchRequest, ListActivitiesQuery, ListMealsQuery};
use crate::journal_archive_db::{self, ApplyJournalAiBatchRequest, ListEntriesQuery};
use crate::productivity_db::{self, ApplyProductivityAiBatchRequest, ListItemsQuery};
use serde_json::{json, Value};
use tauri::AppHandle;

fn ensure_data_dir(data_dir: &str) -> Result<&str, String> {
    if data_dir.trim().is_empty() {
        return Err("请先在设置中配置数据存储位置".into());
    }
    Ok(data_dir)
}

fn to_json<T: serde::Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

macro_rules! archive_read_tool {
    ($struct:ident, $name:expr, $desc:expr, $label:expr, $exec:expr) => {
        pub struct $struct;

        impl AgentTool for $struct {
            fn name(&self) -> &str {
                $name
            }
            fn description(&self) -> &str {
                $desc
            }
            fn parameters(&self) -> Value {
                json!({ "type": "object", "properties": {} })
            }
            fn start_label(&self) -> &str {
                $label
            }
            fn requires_confirm(&self) -> bool {
                false
            }
            fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
                let root = ensure_data_dir(data_dir)?.to_string();
                $exec(root, args)
            }
        }
    };
}

archive_read_tool!(
    ArchiveListProjects,
    "archive_list_projects",
    "列出 Productivity 项目。",
    "正在读取项目…",
    |root: String, _args: Value| {
        productivity_db::list_projects_cmd(&root)
            .map_err(String::from)
            .and_then(to_json)
    }
);

archive_read_tool!(
    ArchiveListLists,
    "archive_list_lists",
    "列出 Productivity 清单。",
    "正在读取清单…",
    |root: String, _args: Value| {
        productivity_db::list_lists_cmd(&root)
            .map_err(String::from)
            .and_then(to_json)
    }
);

pub struct ArchiveListItems;

impl AgentTool for ArchiveListItems {
    fn name(&self) -> &str {
        "archive_list_items"
    }
    fn description(&self) -> &str {
        "列出 Productivity 条目。可选 listId 或 unassignedOnly。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "listId": { "type": "string" },
                "unassignedOnly": { "type": "boolean" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "正在读取条目…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let query: ListItemsQuery = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        productivity_db::list_items_cmd(&root, &query)
            .map_err(String::from)
            .and_then(to_json)
    }
}

archive_read_tool!(
    ArchiveListSessions,
    "archive_list_sessions",
    "列出 Productivity 时段。",
    "正在读取时段…",
    |root: String, _args: Value| {
        productivity_db::list_sessions_cmd(&root)
            .map_err(String::from)
            .and_then(to_json)
    }
);

archive_read_tool!(
    ArchiveListActions,
    "archive_list_actions",
    "列出 Productivity 行动。",
    "正在读取行动…",
    |root: String, _args: Value| {
        productivity_db::list_actions_cmd(&root)
            .map_err(String::from)
            .and_then(to_json)
    }
);

pub struct ArchiveListJournalEntries;

impl AgentTool for ArchiveListJournalEntries {
    fn name(&self) -> &str {
        "archive_list_journal_entries"
    }
    fn description(&self) -> &str {
        "列出 Journal 归档条目（note/document）。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "includeDeleted": { "type": "boolean" },
                "limit": { "type": "integer" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "正在读取 Journal 归档…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let query: ListEntriesQuery = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        journal_archive_db::list_entries(&root, query)
            .map_err(String::from)
            .and_then(to_json)
    }
}

pub struct ArchiveGetJournalEntry;

impl AgentTool for ArchiveGetJournalEntry {
    fn name(&self) -> &str {
        "archive_get_journal_entry"
    }
    fn description(&self) -> &str {
        "读取单条 Journal 归档条目（含 document markdown）。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" }
            },
            "required": ["id"]
        })
    }
    fn start_label(&self) -> &str {
        "正在读取 Journal 条目…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("id 必填")?;
        journal_archive_db::get_entry(&root, id)
            .map_err(String::from)
            .and_then(to_json)
    }
}

pub struct ArchiveListMeals;

impl AgentTool for ArchiveListMeals {
    fn name(&self) -> &str {
        "archive_list_meals"
    }
    fn description(&self) -> &str {
        "列出 Health 餐食记录。可选 localDateFrom/localDateTo。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "localDateFrom": { "type": "string" },
                "localDateTo": { "type": "string" },
                "includeDeleted": { "type": "boolean" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "正在读取餐食…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let query: ListMealsQuery = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        health_db::list_meals(&root, query)
            .map_err(String::from)
            .and_then(to_json)
    }
}

pub struct ArchiveListActivities;

impl AgentTool for ArchiveListActivities {
    fn name(&self) -> &str {
        "archive_list_activities"
    }
    fn description(&self) -> &str {
        "列出 Health 运动记录。可选 localDateFrom/localDateTo、limit、offset。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "localDateFrom": { "type": "string" },
                "localDateTo": { "type": "string" },
                "limit": { "type": "integer" },
                "offset": { "type": "integer" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "正在读取运动…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let query: ListActivitiesQuery = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        health_db::list_activities(&root, query)
            .map_err(String::from)
            .and_then(to_json)
    }
}

pub struct ProductivityApplyAiBatch;

impl AgentTool for ProductivityApplyAiBatch {
    fn name(&self) -> &str {
        "productivity_apply_ai_batch"
    }
    fn description(&self) -> &str {
        "批量写入 Productivity（项目/任务/清单/条目/时段/行动）。不可计时、不可删除。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "ops": {
                    "type": "array",
                    "items": { "type": "object" }
                }
            },
            "required": ["ops"]
        })
    }
    fn start_label(&self) -> &str {
        "正在写入 Productivity…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let req: ApplyProductivityAiBatchRequest = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        productivity_db::commands::apply_productivity_ai_batch(&root, req)
            .map_err(String::from)
            .and_then(to_json)
    }
}

pub struct HealthApplyAiBatch;

impl AgentTool for HealthApplyAiBatch {
    fn name(&self) -> &str {
        "health_apply_ai_batch"
    }
    fn description(&self) -> &str {
        "批量写入 Health 餐食（createMeal/updateMeal）。不可删除。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "ops": {
                    "type": "array",
                    "items": { "type": "object" }
                }
            },
            "required": ["ops"]
        })
    }
    fn start_label(&self) -> &str {
        "正在写入餐食…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let req: ApplyHealthAiBatchRequest = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        health_db::apply_health_ai_batch(&root, req)
            .map_err(String::from)
            .and_then(to_json)
    }
}

pub struct JournalApplyAiBatch;

impl AgentTool for JournalApplyAiBatch {
    fn name(&self) -> &str {
        "journal_apply_ai_batch"
    }
    fn description(&self) -> &str {
        "批量写入 Journal 归档：createNote/updateNote/createDocument/saveDocument/convertNoteToDocument。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "ops": {
                    "type": "array",
                    "items": { "type": "object" }
                }
            },
            "required": ["ops"]
        })
    }
    fn start_label(&self) -> &str {
        "正在写入 Journal 归档…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        let root = ensure_data_dir(data_dir)?.to_string();
        let req: ApplyJournalAiBatchRequest = serde_json::from_value(args)
            .map_err(|e| format!("invalid request: {e}"))?;
        journal_archive_db::apply_journal_ai_batch(&root, req)
            .map_err(String::from)
            .and_then(to_json)
    }
}
