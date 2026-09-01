use std::sync::Arc;

use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::repository::with_transaction;
use crate::db::{utc_now, Database};

#[derive(Debug, Clone)]
pub struct WriterTransitionRow {
    pub account_id: String,
    pub connector: String,
    pub phase: String,
    pub phase_version: i64,
    pub principal: Option<String>,
    pub lease_holder: Option<String>,
    pub lease_expires_at_utc: Option<String>,
    pub fencing_token: Option<String>,
    pub audit_watermark: Option<String>,
    pub drain_watermark: Option<String>,
    pub state_json: String,
}

pub struct WriterTransitionStore;

impl WriterTransitionStore {
    pub fn load(
        db: &Arc<Database>,
        account_id: &str,
        connector: &str,
    ) -> Result<Option<WriterTransitionRow>> {
        with_transaction(db, |tx| {
            tx.query_row(
                "SELECT phase, phase_version, principal, lease_holder, lease_expires_at_utc,
                        fencing_token, audit_watermark, drain_watermark, state_json
                 FROM connector_writer_states WHERE account_id = ?1 AND connector = ?2",
                params![account_id, connector],
                |row| {
                    Ok(WriterTransitionRow {
                        account_id: account_id.to_string(),
                        connector: connector.to_string(),
                        phase: row.get(0)?,
                        phase_version: row.get(1)?,
                        principal: row.get(2)?,
                        lease_holder: row.get(3)?,
                        lease_expires_at_utc: row.get(4)?,
                        fencing_token: row.get(5)?,
                        audit_watermark: row.get(6)?,
                        drain_watermark: row.get(7)?,
                        state_json: row.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
        })
    }

    pub fn cas_transition(
        db: &Arc<Database>,
        row: &WriterTransitionRow,
        expected_phase_version: i64,
        new_phase: &str,
        lease_holder: Option<&str>,
        lease_expires_at_utc: Option<&str>,
        fencing_token: Option<&str>,
        audit_watermark: Option<&str>,
        drain_watermark: Option<&str>,
    ) -> Result<WriterTransitionRow> {
        with_transaction(db, |tx| {
            let current: Option<i64> = tx
                .query_row(
                    "SELECT phase_version FROM connector_writer_states
                     WHERE account_id = ?1 AND connector = ?2",
                    params![row.account_id, row.connector],
                    |r| r.get(0),
                )
                .optional()?;
            let current = current.ok_or_else(|| anyhow!("writer state missing"))?;
            if current != expected_phase_version {
                return Err(anyhow!("phase version CAS mismatch"));
            }
            let now = utc_now();
            let next_version = expected_phase_version + 1;
            let new_token = fencing_token
                .map(str::to_string)
                .or_else(|| Some(Uuid::new_v4().to_string()));
            let affected = tx.execute(
                "UPDATE connector_writer_states SET
                    phase = ?1, phase_version = ?2, lease_holder = ?3,
                    lease_expires_at_utc = ?4, fencing_token = ?5,
                    audit_watermark = COALESCE(?6, audit_watermark),
                    drain_watermark = COALESCE(?7, drain_watermark),
                    updated_at_utc = ?8
                 WHERE account_id = ?9 AND connector = ?10 AND phase_version = ?11",
                params![
                    new_phase,
                    next_version,
                    lease_holder,
                    lease_expires_at_utc,
                    new_token,
                    audit_watermark,
                    drain_watermark,
                    now,
                    row.account_id,
                    row.connector,
                    expected_phase_version
                ],
            )?;
            // The version check is part of the write itself: a read-then-write check
            // would allow a second coordinator to steal a writer lease between them.
            if affected != 1 {
                return Err(anyhow!("phase version CAS lost update"));
            }
            let mut out = row.clone();
            out.phase = new_phase.to_string();
            out.phase_version = next_version;
            out.lease_holder = lease_holder.map(str::to_string);
            out.lease_expires_at_utc = lease_expires_at_utc.map(str::to_string);
            out.fencing_token = new_token;
            if audit_watermark.is_some() {
                out.audit_watermark = audit_watermark.map(str::to_string);
            }
            if drain_watermark.is_some() {
                out.drain_watermark = drain_watermark.map(str::to_string);
            }
            Ok(out)
        })
    }

    pub fn verify_lease(
        row: &WriterTransitionRow,
        holder: &str,
        fencing_token: &str,
    ) -> Result<()> {
        if row.lease_holder.as_deref() != Some(holder) {
            return Err(anyhow!("lease holder mismatch"));
        }
        if row.fencing_token.as_deref() != Some(fencing_token) {
            return Err(anyhow!("fencing token mismatch"));
        }
        if let Some(exp) = &row.lease_expires_at_utc {
            let exp = chrono::DateTime::parse_from_rfc3339(exp)
                .map_err(|_| anyhow!("invalid lease expiry"))?;
            if chrono::Utc::now() > exp.with_timezone(&chrono::Utc) {
                return Err(anyhow!("lease expired"));
            }
        } else {
            return Err(anyhow!("no active lease"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::secrets::install_test_secrets;
    use crate::db::repository::{AccountRepo, with_transaction};
    use crate::db::test_db;

    fn seed_writer(db: &Arc<Database>, account: &str, connector: &str) {
        with_transaction(db, |tx| {
            AccountRepo::ensure_account(tx, account)?;
            let now = utc_now();
            tx.execute(
                "INSERT INTO connector_writer_states(
                    account_id, connector, phase, phase_version, state_json, updated_at_utc
                ) VALUES (?1,?2,'DesktopCollectorActive',1,'{}',?3)",
                params![account, connector, now],
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn cas_rejects_stale_version() {
        install_test_secrets();
        let db = test_db();
        let account = "acct-1";
        seed_writer(&db, account, "garmin");
        let row = WriterTransitionStore::load(&db, account, "garmin").unwrap().unwrap();
        WriterTransitionStore::cas_transition(
            &db,
            &row,
            1,
            "Drain",
            Some("server"),
            Some(&utc_now()),
            None,
            None,
            None,
        )
        .unwrap();
        assert!(WriterTransitionStore::cas_transition(
            &db,
            &row,
            1,
            "ServerObserve",
            None,
            None,
            None,
            None,
            None,
        )
        .is_err());
    }
}
