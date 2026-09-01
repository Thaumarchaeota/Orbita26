use anyhow::Result;
use rusqlite::params;
use serde::Serialize;

use crate::db::Database;
use crate::diagnostics::timeline::{SafeTimelineEvent, TimelineRepo};
use crate::redaction::hash_id;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsBundle {
    pub generated_at_utc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op_id: Option<String>,
    pub timeline: Vec<SafeTimelineEvent>,
    pub delivery_acks: Vec<DeliveryAckSummary>,
    pub open_conflicts_count: i64,
    pub connector_writer_states: Vec<ConnectorPhaseSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryAckSummary {
    pub device_id_hash: String,
    pub delivered_change_seq: i64,
    pub updated_at_utc: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorPhaseSummary {
    pub connector: String,
    pub phase: String,
    pub phase_version: i64,
    pub updated_at_utc: String,
}

pub fn build_bundle(db: &Database, account_id: &str, op_id: Option<&str>) -> Result<DiagnosticsBundle> {
    let conn = db.conn()?;
    let timeline = if let Some(op) = op_id {
        TimelineRepo::timeline_for_op(&conn, account_id, op)?
    } else {
        TimelineRepo::recent_events(&conn, account_id, 100)?
    }
    .into_iter()
    .map(SafeTimelineEvent::from)
    .collect();

    let mut ack_stmt = conn.prepare(
        "SELECT device_id, delivered_change_seq, updated_at_utc
         FROM delivery_acks WHERE account_id = ?1",
    )?;
    let acks = ack_stmt
        .query_map(params![account_id], |row| {
            Ok(DeliveryAckSummary {
                device_id_hash: hash_id(&row.get::<_, String>(0)?),
                delivered_change_seq: row.get(1)?,
                updated_at_utc: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let open_conflicts_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM conflicts WHERE account_id = ?1 AND status = 'open'",
        params![account_id],
        |row| row.get(0),
    )?;

    let mut writer_stmt = conn.prepare(
        "SELECT connector, phase, phase_version, updated_at_utc
         FROM connector_writer_states WHERE account_id = ?1",
    )?;
    let writers = writer_stmt
        .query_map(params![account_id], |row| {
            Ok(ConnectorPhaseSummary {
                connector: row.get(0)?,
                phase: row.get(1)?,
                phase_version: row.get(2)?,
                updated_at_utc: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(DiagnosticsBundle {
        generated_at_utc: crate::db::utc_now(),
        op_id: op_id.map(str::to_string),
        timeline,
        delivery_acks: acks,
        open_conflicts_count,
        connector_writer_states: writers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository::{ensure_test_account, with_transaction};
    use crate::db::test_db;
    use crate::diagnostics::timeline::{TimelineRepo, EVENT_ACK};
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn bundle_excludes_sensitive_writer_fields() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        with_transaction(&db, |tx| {
            tx.execute(
                "INSERT INTO connector_writer_states(
                    account_id, connector, phase, principal, lease_holder,
                    fencing_token, state_json, updated_at_utc, phase_version
                ) VALUES (?1,'garmin','active','secret','holder','token','{\"key\":\"val\"}','now',2)",
                params![account],
            )?;
            Ok(())
        })
        .unwrap();
        let bundle = build_bundle(&db, &account, None).unwrap();
        assert_eq!(bundle.connector_writer_states.len(), 1);
        assert_eq!(bundle.connector_writer_states[0].phase, "active");
        let json = serde_json::to_string(&bundle).unwrap();
        assert!(!json.contains("fencing_token"));
        assert!(!json.contains("state_json"));
        assert!(!json.contains("secret"));
    }

    #[test]
    fn bundle_filters_by_op_id() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        let op_a = Uuid::new_v4().to_string();
        let op_b = Uuid::new_v4().to_string();
        with_transaction(&db, |tx| {
            TimelineRepo::append_event(tx, &account, &op_a, None, None, EVENT_ACK, &json!({}))?;
            TimelineRepo::append_event(tx, &account, &op_b, None, None, EVENT_ACK, &json!({}))?;
            Ok(())
        })
        .unwrap();
        let bundle = build_bundle(&db, &account, Some(&op_a)).unwrap();
        assert_eq!(bundle.timeline.len(), 1);
        assert_eq!(bundle.timeline.len(), 1);
    }
}
