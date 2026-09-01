use std::sync::Arc;

use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::repository::with_transaction;
use crate::db::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriterState {
    pub account_id: String,
    pub connector: String,
    pub phase: String,
    pub principal: Option<String>,
    pub lease_holder: Option<String>,
    pub lease_expires_at_utc: Option<String>,
    pub audit_watermark: Option<String>,
    pub state_json: String,
}

pub struct WriterStateStore;

impl WriterStateStore {
    pub(crate) fn load(
        db: &Arc<Database>,
        account_id: &str,
        connector: &str,
    ) -> Result<Option<WriterState>> {
        with_transaction(db, |tx| {
            let row: Option<(String, Option<String>, Option<String>, Option<String>, Option<String>, String)> =
                tx.query_row(
                    "SELECT phase, principal, lease_holder, lease_expires_at_utc, audit_watermark, state_json
                     FROM connector_writer_states WHERE account_id = ?1 AND connector = ?2",
                    params![account_id, connector],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )
                .optional()?;
            Ok(row.map(
                |(phase, principal, lease_holder, lease_expires_at_utc, audit_watermark, state_json)| {
                    WriterState {
                        account_id: account_id.to_string(),
                        connector: connector.to_string(),
                        phase,
                        principal,
                        lease_holder,
                        lease_expires_at_utc,
                        audit_watermark,
                        state_json,
                    }
                },
            ))
        })
    }

}
