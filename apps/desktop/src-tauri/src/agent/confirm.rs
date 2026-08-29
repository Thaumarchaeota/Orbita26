use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

type ConfirmResult = Result<Value, String>;
type Sender = oneshot::Sender<ConfirmResult>;

static PENDING: Mutex<Option<HashMap<String, Sender>>> = Mutex::new(None);

fn map_mut<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, Sender>) -> R,
{
    let mut guard = PENDING.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    f(guard.as_mut().unwrap())
}

pub fn register(id: String) -> oneshot::Receiver<ConfirmResult> {
    let (tx, rx) = oneshot::channel();
    map_mut(|m| {
        m.insert(id, tx);
    });
    rx
}

pub fn resolve(id: &str, result: ConfirmResult) -> Result<(), String> {
    let tx = map_mut(|m| m.remove(id)).ok_or_else(|| "确认已过期或已处理".to_string())?;
    tx.send(result).map_err(|_| "确认通道已关闭".to_string())
}
