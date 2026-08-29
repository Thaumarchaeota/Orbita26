mod bkeasy;
mod fs;
mod garmin_tool;
mod journal;
mod ticktick;

use std::sync::OnceLock;
use serde_json::Value;
use tauri::AppHandle;

pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;
    fn start_label(&self) -> &str;
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String>;
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
            Box::new(garmin_tool::GarminSyncTool),
            Box::new(garmin_tool::GarminLoginTool),
            Box::new(bkeasy::BkeasySummaryTool),
            Box::new(bkeasy::BeancountAddTransaction),
            Box::new(fs::OpenPath),
            Box::new(fs::RevealPath),
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

pub fn tool_schemas() -> Vec<Value> {
    tool_defs()
        .iter()
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
        .collect()
}

pub fn start_label(name: &str) -> String {
    tool_defs()
        .iter()
        .find(|t| t.name() == name)
        .map(|t| t.start_label().to_string())
        .unwrap_or_else(|| format!("正在执行 {name}…"))
}

pub fn execute(app: &AppHandle, name: &str, args: Value) -> Result<String, String> {
    for tool in tool_defs() {
        if tool.name() == name {
            return tool.execute(app, args);
        }
    }
    Err(format!("未知工具: {name}"))
}

pub fn affects_journal(name: &str) -> bool {
    name.starts_with("journal_") || name == "garmin_sync"
}
