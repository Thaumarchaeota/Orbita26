use super::AgentTool;
use crate::paths;
use serde_json::{json, Value};
use tauri::AppHandle;

fn read_path(args: &Value) -> Result<String, String> {
    args.get("path")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "缺少 path".into())
}

pub struct OpenPath;

impl AgentTool for OpenPath {
    fn name(&self) -> &str {
        "open_path"
    }

    fn description(&self) -> &str {
        "用系统默认方式打开文件或文件夹（等同双击）。路径必须是已存在的绝对路径。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "绝对路径" }
            },
            "required": ["path"]
        })
    }

    fn start_label(&self) -> &str {
        "本地 · 打开路径"
    }

    fn execute(&self, app: &AppHandle, _data_dir: &str, args: Value) -> Result<String, String> {
        let path = read_path(&args)?;
        paths::open_local_path(app, &path)?;
        Ok(json!({ "ok": true, "path": path }).to_string())
    }
}

pub struct RevealPath;

impl AgentTool for RevealPath {
    fn name(&self) -> &str {
        "reveal_path"
    }

    fn description(&self) -> &str {
        "在资源管理器中定位并选中文件，或打开文件夹。路径必须是已存在的绝对路径。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "绝对路径" }
            },
            "required": ["path"]
        })
    }

    fn start_label(&self) -> &str {
        "本地 · 定位路径"
    }

    fn execute(&self, app: &AppHandle, _data_dir: &str, args: Value) -> Result<String, String> {
        let _ = app;
        let path = read_path(&args)?;
        paths::reveal_path_in_explorer(&path)?;
        Ok(json!({ "ok": true, "path": path }).to_string())
    }
}
