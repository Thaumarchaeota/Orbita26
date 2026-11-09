use chrono::Utc;
use uuid::Uuid;

pub fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}
