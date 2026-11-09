mod archive;
mod bkeasy;
mod fs;
mod journal;
mod ticktick;

use std::sync::OnceLock;
use crate::ai::AiEntryPoint;
use serde_json::Value;
use tauri::AppHandle;

const PANEL_ALLOWED: &[&str] = &[
    "search_public_web",
    "journal_list",
    "journal_snapshot",
    "bkeasy_summary",
    "archive_list_projects",
    "archive_list_lists",
    "archive_list_items",
    "archive_list_sessions",
    "archive_list_actions",
    "archive_list_journal_entries",
    "archive_get_journal_entry",
    "archive_list_meals",
    "archive_list_activities",
];

const INSIGHT_ALLOWED: &[&str] = &[
    "search_public_web",
    "journal_list",
    "journal_snapshot",
    "bkeasy_summary",
    "journal_add_meal",
    "journal_update_meal",
    "journal_delete_meal",
    "archive_list_projects",
    "archive_list_lists",
    "archive_list_items",
    "archive_list_sessions",
    "archive_list_actions",
    "archive_list_journal_entries",
    "archive_get_journal_entry",
    "archive_list_meals",
    "archive_list_activities",
    "productivity_apply_ai_batch",
    "journal_apply_ai_batch",
    "health_apply_ai_batch",
];
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;
    fn start_label(&self) -> &str;
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String>;
}

fn tool_defs() -> &'static Vec<Box<dyn AgentTool>> {
    static TOOLS: OnceLock<Vec<Box<dyn AgentTool>>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        vec![
            Box::new(ticktick::TicktickListTasks),
            Box::new(ticktick::TicktickCreateTask),
            Box::new(ticktick::TicktickUpdateTask),
            Box::new(ticktick::TicktickDeleteTask),
            Box::new(journal::JournalList),
            Box::new(journal::JournalSnapshot),
            Box::new(journal::JournalAddEvent),
            Box::new(journal::JournalAddMood),
            Box::new(journal::JournalSetSleep),
            Box::new(journal::JournalAddNap),
            Box::new(journal::JournalDeleteEntry),
            Box::new(journal::JournalAddMeal),
            Box::new(journal::JournalUpdateMeal),
            Box::new(journal::JournalDeleteMeal),
            Box::new(bkeasy::BkeasySummaryTool),
            Box::new(bkeasy::BeancountAddTransaction),
            Box::new(fs::OpenPath),
            Box::new(fs::RevealPath),
            Box::new(archive::ArchiveListProjects),
            Box::new(archive::ArchiveListLists),
            Box::new(archive::ArchiveListItems),
            Box::new(archive::ArchiveListSessions),
            Box::new(archive::ArchiveListActions),
            Box::new(archive::ArchiveListJournalEntries),
            Box::new(archive::ArchiveGetJournalEntry),
            Box::new(archive::ArchiveListMeals),
            Box::new(archive::ArchiveListActivities),
            Box::new(archive::ProductivityApplyAiBatch),
            Box::new(archive::JournalApplyAiBatch),
            Box::new(archive::HealthApplyAiBatch),
        ]
    })
}

pub fn local_now_line() -> String {
    ticktick::local_now_line()
}

pub fn requires_confirm(name: &str) -> bool {
    tool_defs()
        .iter()
        .find(|t| t.name() == name)
        .map(|t| t.requires_confirm())
        .unwrap_or(false)
}

pub fn is_tool_allowed(entry: AiEntryPoint, name: &str) -> bool {
    if name != "search_public_web" && !tool_defs().iter().any(|t| t.name() == name) {
        return false;
    }
    match entry {
        AiEntryPoint::Panel => PANEL_ALLOWED.contains(&name),
        AiEntryPoint::Insight => INSIGHT_ALLOWED.contains(&name),
    }
}

pub fn tool_schemas_for(entry: AiEntryPoint) -> Vec<Value> {
    let mut schemas: Vec<Value> = tool_defs()
        .iter()
        .filter(|t| is_tool_allowed(entry, t.name()))
        .map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name(),
                    "description": t.description(),
                    "parameters": t.parameters(),
                }
            })
        })
        .collect();
    if is_tool_allowed(entry, "search_public_web") {
        schemas.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "search_public_web",
                "description": "仅在当前问题确需近期、实时或可能变化的公开网页信息时调用。先用本地工具回答 Orbita 本地问题；静态知识直接回答。只传简短公开搜索问题，不得包含本地记录、路径、凭据、附件或完整对话。天气/气温问题必须提供用户原话明确给出的城市或地区 location；不得据 IP、时区或猜测补地点。未给地点时直接追问用户。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "简短的公开网页搜索问题" },
                        "location": { "type": "string", "description": "仅天气/气温类查询必填：用户原话明确出现、且 query 中原样出现的城市或地区；不可猜测" }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }
            }
        }));
    }
    schemas
}

pub fn start_label(name: &str) -> String {
    tool_defs()
        .iter()
        .find(|t| t.name() == name)
        .map(|t| t.start_label().to_string())
        .unwrap_or_else(|| format!("正在执行 {name}…"))
}

pub fn execute(
    app: &AppHandle,
    data_dir: &str,
    name: &str,
    args: Value,
    entry: AiEntryPoint,
) -> Result<String, String> {
    if !is_tool_allowed(entry, name) {
        return Err(format!("工具 {name} 在当前入口不可用"));
    }
    for tool in tool_defs() {
        if tool.name() == name {
            return tool.execute(app, data_dir, args);
        }
    }
    Err(format!("未知工具: {name}"))
}

pub fn affects_journal(name: &str) -> bool {
    name.starts_with("journal_") || name == "garmin_sync"
}

#[cfg(test)]
mod garmin_entry_tests {
    use super::*;

    #[test]
    fn agent_cannot_discover_or_execute_garmin_sync_or_login() {
        assert!(!is_tool_allowed(AiEntryPoint::Panel, "garmin_sync"));
        assert!(!is_tool_allowed(AiEntryPoint::Insight, "garmin_sync"));
        assert!(!is_tool_allowed(AiEntryPoint::Insight, "garmin_login"));
        assert!(tool_schemas_for(AiEntryPoint::Panel).iter().all(|schema| {
            schema.pointer("/function/name").and_then(Value::as_str) != Some("garmin_sync")
        }));
    }
}
