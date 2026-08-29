use super::AgentTool;
use crate::garmin;
use serde_json::{json, Value};
use tauri::AppHandle;

pub struct GarminSyncTool;

impl AgentTool for GarminSyncTool {
    fn name(&self) -> &str {
        "garmin_sync"
    }
    fn description(&self) -> &str {
        "从佳明 Connect 同步生活数据到本地 journal（步数、心率、喝水、运动等）。\
         需已登录佳明；days 为回溯天数，默认 7；用户未说明时勿超过 7。勿用于登录。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "days": { "type": "integer", "description": "同步最近 N 天，1-30，默认 7" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "准备同步佳明…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        let days = args
            .get("days")
            .and_then(|v| v.as_i64())
            .map(|n| n.clamp(1, 30) as i32)
            .unwrap_or(7);
        let to = crate::journal::beijing_today();
        let from = subtract_days(&to, days - 1)?;
        let res = garmin::garmin_sync(
            app,
            garmin::GarminSyncRequest {
                from: Some(from),
                to: Some(to),
            },
        )?;
        serde_json::to_string(&res).map_err(|e| e.to_string())
    }
}

pub struct GarminLoginTool;

impl AgentTool for GarminLoginTool {
    fn name(&self) -> &str {
        "garmin_login"
    }
    fn description(&self) -> &str {
        "佳明 SSO 重新登录，获取新 token。仅当用户明确要求重新登录或 token 失效时使用；勿与 garmin_sync 混用。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }
    fn start_label(&self) -> &str {
        "准备登录佳明…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, _args: Value) -> Result<String, String> {
        let res = garmin::garmin_login(
            app,
            garmin::GarminLoginRequest {
                email: None,
                password: None,
            },
        )?;
        serde_json::to_string(&res).map_err(|e| e.to_string())
    }
}

fn subtract_days(date: &str, days: i32) -> Result<String, String> {
    use chrono::{Duration, NaiveDate};
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "invalid date")?;
    Ok((d - Duration::days(days as i64))
        .format("%Y-%m-%d")
        .to_string())
}
