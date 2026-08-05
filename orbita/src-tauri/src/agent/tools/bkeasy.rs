use super::AgentTool;
use crate::beancount::{default_writer, BeancountTransaction, BeancountWriter};
use crate::bkeasy;
use crate::journal::beijing_today;
use serde_json::{json, Value};
use tauri::AppHandle;

pub struct BkeasySummaryTool;

impl AgentTool for BkeasySummaryTool {
    fn name(&self) -> &str {
        "bkeasy_summary"
    }
    fn description(&self) -> &str {
        "查询账本支出摘要：今日支出、本月支出（元）。需配置账本目录。"
    }
    fn parameters(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    fn start_label(&self) -> &str {
        "正在查询账本…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, app: &AppHandle, _args: Value) -> Result<String, String> {
        let res = bkeasy::bkeasy_summary(app)?;
        serde_json::to_string(&res).map_err(|e| e.to_string())
    }
}

pub struct BeancountAddTransaction;

impl AgentTool for BeancountAddTransaction {
    fn name(&self) -> &str {
        "beancount_add_transaction"
    }
    fn description(&self) -> &str {
        "向 beancount 账本记一笔支出（接口预留，写入尚未实现）。\
         date YYYY-MM-DD；amount 正数表示支出金额；description 摘要；category 如 餐饮/交通。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "amount": { "type": "number", "description": "支出金额（元）" },
                "description": { "type": "string" },
                "category": { "type": "string", "description": "分类名，映射 Expenses 科目" }
            },
            "required": ["amount", "description"]
        })
    }
    fn start_label(&self) -> &str {
        "准备记账…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        let date = args
            .get("date")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(beijing_today);
        let amount = args
            .get("amount")
            .and_then(|v| v.as_f64())
            .filter(|n| *n > 0.0)
            .ok_or("amount 须为正数")?;
        let description = args
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("description 必填")?
            .to_string();
        let category = args
            .get("category")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let res = default_writer().append_expense(
            app,
            BeancountTransaction {
                date,
                amount,
                description,
                category,
            },
        )?;
        serde_json::to_string(&res).map_err(|e| e.to_string())
    }
}
