use serde_json::Value;
use tauri::AppHandle;

pub struct BeancountTransaction {
    pub date: String,
    pub amount: f64,
    pub description: String,
    pub category: Option<String>,
}

pub trait BeancountWriter {
    fn append_expense(&self, app: &AppHandle, tx: BeancountTransaction) -> Result<Value, String>;
}

pub struct BkeasyBeancountWriter;

impl BeancountWriter for BkeasyBeancountWriter {
    fn append_expense(&self, _app: &AppHandle, _tx: BeancountTransaction) -> Result<Value, String> {
        Err("beancount 写入尚未实现".into())
    }
}

pub fn default_writer() -> BkeasyBeancountWriter {
    BkeasyBeancountWriter
}
