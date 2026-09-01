use anyhow::Result;
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::db::{utc_now, Database};
use crate::redaction::redact_value;

pub const EVENT_PUSH: &str = "push";
pub const EVENT_PULL: &str = "pull";
pub const EVENT_ACK: &str = "ack";
pub const EVENT_CONFLICT: &str = "conflict";
pub const EVENT_RESOLVE: &str = "resolve";

/// Internal persistence shape. Never return this directly: it contains account and
/// correlation identifiers needed for server-side incident correlation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: String,
    pub account_id: String,
    pub op_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    pub event_kind: String,
    pub detail: Value,
    pub created_at_utc: String,
}

/// Deliberately small support-facing view. Diagnostic export must not become a
/// second data API or disclose account/device/correlation identifiers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeTimelineEvent {
    pub event_kind: String,
    pub detail: Value,
    pub created_at_utc: String,
}

impl From<TimelineEvent> for SafeTimelineEvent {
    fn from(event: TimelineEvent) -> Self {
        Self {
            detail: safe_detail(&event.event_kind, &event.detail),
            event_kind: event.event_kind,
            created_at_utc: event.created_at_utc,
        }
    }
}

fn safe_detail(event_kind: &str, detail: &Value) -> Value {
    let object = detail.as_object();
    let allowed: &[&str] = match event_kind {
        EVENT_PUSH | EVENT_RESOLVE => &["status", "kind", "domain", "recordType", "serverVersion", "changeSeq"],
        EVENT_CONFLICT => &["domain", "recordType", "serverVersion"],
        EVENT_PULL => &["cursor", "changeCount", "nextChangeSeq", "hasMore"],
        EVENT_ACK => &["deliveredChangeSeq"],
        _ => &[],
    };
    let mut safe = serde_json::Map::new();
    for key in allowed {
        if let Some(value) = object.and_then(|values| values.get(*key)) {
            // Only scalar operational facts are useful for support and safe to export.
            if value.is_string() || value.is_number() || value.is_boolean() || value.is_null() {
                safe.insert((*key).to_string(), value.clone());
            }
        }
    }
    Value::Object(safe)
}

pub struct TimelineRepo;

impl TimelineRepo {
    pub fn append_event(
        tx: &Transaction<'_>,
        account_id: &str,
        op_id: &str,
        correlation_id: Option<&str>,
        connector: Option<&str>,
        event_kind: &str,
        detail: &Value,
    ) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = utc_now();
        let redacted = redact_value(detail);
        let detail_json = serde_json::to_string(&redacted)?;
        tx.execute(
            "INSERT INTO operation_events(
                id, account_id, op_id, correlation_id, connector, event_kind, detail_json, created_at_utc
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                id,
                account_id,
                op_id,
                correlation_id,
                connector,
                event_kind,
                detail_json,
                now
            ],
        )?;
        Ok(())
    }

    pub fn timeline_for_op(
        conn: &rusqlite::Connection,
        account_id: &str,
        op_id: &str,
    ) -> Result<Vec<TimelineEvent>> {
        let mut stmt = conn.prepare(
            "SELECT id, account_id, op_id, correlation_id, connector, event_kind, detail_json, created_at_utc
             FROM operation_events
             WHERE account_id = ?1 AND op_id = ?2
             ORDER BY created_at_utc ASC",
        )?;
        let rows = stmt.query_map(params![account_id, op_id], |row| {
            let detail_json: String = row.get(6)?;
            let detail = serde_json::from_str(&detail_json).unwrap_or(Value::Null);
            Ok(TimelineEvent {
                id: row.get(0)?,
                account_id: row.get(1)?,
                op_id: row.get(2)?,
                correlation_id: row.get(3)?,
                connector: row.get(4)?,
                event_kind: row.get(5)?,
                detail,
                created_at_utc: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn recent_events(
        conn: &rusqlite::Connection,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<TimelineEvent>> {
        let mut stmt = conn.prepare(
            "SELECT id, account_id, op_id, correlation_id, connector, event_kind, detail_json, created_at_utc
             FROM operation_events
             WHERE account_id = ?1
             ORDER BY created_at_utc DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![account_id, limit as i64], |row| {
            let detail_json: String = row.get(6)?;
            let detail = serde_json::from_str(&detail_json).unwrap_or(Value::Null);
            Ok(TimelineEvent {
                id: row.get(0)?,
                account_id: row.get(1)?,
                op_id: row.get(2)?,
                correlation_id: row.get(3)?,
                connector: row.get(4)?,
                event_kind: row.get(5)?,
                detail,
                created_at_utc: row.get(7)?,
            })
        })?;
        let mut events: Vec<TimelineEvent> = rows.collect::<Result<Vec<_>, _>>()?;
        events.reverse();
        Ok(events)
    }

    pub fn query_timeline(db: &Database, account_id: &str, op_id: &str) -> Result<Vec<TimelineEvent>> {
        let conn = db.conn()?;
        Self::timeline_for_op(&conn, account_id, op_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository::{ensure_test_account, with_transaction};
    use crate::db::test_db;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn append_and_query_timeline() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        let op_id = Uuid::new_v4().to_string();
        let correlation_id = Uuid::new_v4().to_string();
        with_transaction(&db, |tx| {
            TimelineRepo::append_event(
                tx,
                &account,
                &op_id,
                Some(&correlation_id),
                Some("manual"),
                EVENT_PUSH,
                &json!({"status": "accepted", "snapshot": {"body": "secret"}}),
            )
        })
        .unwrap();
        let events = TimelineRepo::query_timeline(&db, &account, &op_id).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_kind, EVENT_PUSH);
        assert_eq!(events[0].detail["snapshot"], "[REDACTED]");
        assert_eq!(events[0].correlation_id.as_deref(), Some(correlation_id.as_str()));
    }

    #[test]
    fn timeline_scoped_to_account() {
        let db = test_db();
        let account_a = Uuid::new_v4().to_string();
        let account_b = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account_a).unwrap();
        ensure_test_account(&db, &account_b).unwrap();
        let op_id = Uuid::new_v4().to_string();
        with_transaction(&db, |tx| {
            TimelineRepo::append_event(
                tx,
                &account_a,
                &op_id,
                None,
                None,
                EVENT_PUSH,
                &json!({}),
            )
        })
        .unwrap();
        assert!(TimelineRepo::query_timeline(&db, &account_b, &op_id)
            .unwrap()
            .is_empty());
    }
}
