use std::sync::Arc;

use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use crate::connectors::ticktick::outbox::{CommandStatus, WorkCommand};
use crate::db::repository::with_transaction;
use crate::db::{utc_now, Database};

pub struct WorkCommandStore;

impl WorkCommandStore {
    pub fn insert(db: &Arc<Database>, cmd: &WorkCommand) -> Result<()> {
        if cmd.expected_content_hash.is_none() && cmd.expected_external_etag.is_none() {
            return Err(anyhow!("expected_content_hash or expected_external_etag required"));
        }
        with_transaction(db, |tx| {
            let now = utc_now();
            tx.execute(
                "INSERT INTO work_commands(
                    command_id, account_id, origin_device_id, kind_json, payload_hash,
                    expected_content_hash, expected_external_etag, status, attempts,
                    max_attempts, retry_once_consumed, created_at_utc, updated_at_utc
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0,?11,?12)",
                params![
                    cmd.command_id.to_string(),
                    cmd.account_id,
                    cmd.origin_device_id,
                    serde_json::to_string(&cmd.kind)?,
                    cmd.payload_hash,
                    cmd.expected_content_hash,
                    cmd.expected_external_etag,
                    status_str(cmd.status),
                    cmd.attempts,
                    cmd.max_attempts,
                    now,
                    now
                ],
            )?;
            Ok(())
        })
    }

    pub fn claim(
        db: &Arc<Database>,
        command_id: &str,
        lease_holder: &str,
        fencing_token: &str,
        ttl_secs: i64,
    ) -> Result<()> {
        with_transaction(db, |tx| {
            let now = utc_now();
            let expires = (chrono::Utc::now() + chrono::Duration::seconds(ttl_secs)).to_rfc3339();
            tx.execute(
                "INSERT INTO work_command_claims(command_id, lease_holder, fencing_token, claimed_at_utc, expires_at_utc)
                 VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(command_id) DO UPDATE SET
                    lease_holder = excluded.lease_holder,
                    fencing_token = excluded.fencing_token,
                    claimed_at_utc = excluded.claimed_at_utc,
                    expires_at_utc = excluded.expires_at_utc",
                params![command_id, lease_holder, fencing_token, now, expires],
            )?;
            tx.execute(
                "UPDATE work_commands SET status = 'in_flight', attempts = attempts + 1, updated_at_utc = ?1
                 WHERE command_id = ?2 AND status IN ('pending','failed')",
                params![now, command_id],
            )?;
            Ok(())
        })
    }

    pub fn complete_with_expectation(
        db: &Arc<Database>,
        command_id: &str,
        expected_content_hash: Option<&str>,
        expected_external_etag: Option<&str>,
        status: CommandStatus,
        summary: &str,
    ) -> Result<()> {
        with_transaction(db, |tx| {
            let row: (Option<String>, Option<String>, String) = tx.query_row(
                "SELECT expected_content_hash, expected_external_etag, status FROM work_commands WHERE command_id = ?1",
                params![command_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            if expected_content_hash.is_some()
                && row.0.as_deref() != expected_content_hash
            {
                return Err(anyhow!("expected_content_hash mismatch"));
            }
            if expected_external_etag.is_some()
                && row.1.as_deref() != expected_external_etag
            {
                return Err(anyhow!("expected_external_etag mismatch"));
            }
            let now = utc_now();
            tx.execute(
                "UPDATE work_commands SET status = ?1, result_summary = ?2, updated_at_utc = ?3
                 WHERE command_id = ?4",
                params![status_str(status), summary, now, command_id],
            )?;
            Ok(())
        })
    }

    pub fn enter_manual_confirmation(
        db: &Arc<Database>,
        command_id: &str,
        account_id: &str,
        reason: &str,
    ) -> Result<()> {
        with_transaction(db, |tx| {
            let now = utc_now();
            tx.execute(
                "UPDATE work_commands SET status = 'awaiting_manual_confirmation', updated_at_utc = ?1
                 WHERE command_id = ?2",
                params![now, command_id],
            )?;
            tx.execute(
                "INSERT INTO manual_confirmations(id, command_id, account_id, reason, created_at_utc)
                 VALUES (?1,?2,?3,?4,?5)",
                params![Uuid::new_v4().to_string(), command_id, account_id, reason, now],
            )?;
            Ok(())
        })
    }

    pub fn consume_retry_once(db: &Arc<Database>, command_id: &str) -> Result<bool> {
        with_transaction(db, |tx| {
            let consumed: i64 = tx.query_row(
                "SELECT retry_once_consumed FROM work_commands WHERE command_id = ?1",
                params![command_id],
                |r| r.get(0),
            )?;
            if consumed != 0 {
                return Ok(false);
            }
            let now = utc_now();
            tx.execute(
                "UPDATE work_commands SET retry_once_consumed = 1, updated_at_utc = ?1
                 WHERE command_id = ?2 AND retry_once_consumed = 0",
                params![now, command_id],
            )?;
            Ok(true)
        })
    }
}

pub struct OAuthTransactionStore;

#[derive(Debug)]
pub struct OAuthRow {
    pub transaction_id: String,
    pub account_id: String,
    pub device_id: String,
}

impl OAuthTransactionStore {
    pub fn insert(
        db: &Arc<Database>,
        transaction_id: &str,
        account_id: &str,
        device_id: &str,
        state: &str,
        pkce_verifier: &str,
        redirect_uri: &str,
        expires_at_utc: &str,
    ) -> Result<()> {
        with_transaction(db, |tx| {
            let now = utc_now();
            let state_hash = crate::canonical::content_hash(&Value::String(state.to_string()));
            tx.execute(
                "INSERT INTO oauth_transactions(
                    transaction_id, account_id, device_id, state_hash, pkce_verifier_enc,
                    redirect_uri, created_at_utc, expires_at_utc, status
                ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending')",
                params![
                    transaction_id,
                    account_id,
                    device_id,
                    state_hash,
                    pkce_verifier,
                    redirect_uri,
                    now,
                    expires_at_utc
                ],
            )?;
            Ok(())
        })
    }

    pub fn consume(
        db: &Arc<Database>,
        transaction_id: &str,
        account_id: &str,
        device_id: &str,
    ) -> Result<Option<String>> {
        with_transaction(db, |tx| {
            let row: Option<(String, String, String, Option<String>)> = tx
                .query_row(
                    "SELECT account_id, device_id, pkce_verifier_enc, consumed_at_utc
                     FROM oauth_transactions WHERE transaction_id = ?1 AND status = 'pending'",
                    params![transaction_id],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((acct, dev, verifier, consumed)) = row else {
                return Ok(None);
            };
            if consumed.is_some() || acct != account_id || dev != device_id {
                return Err(anyhow!("oauth transaction mismatch or consumed"));
            }
            let now = utc_now();
            let updated = tx.execute(
                "UPDATE oauth_transactions SET consumed_at_utc = ?1, status = 'exchanged'
                 WHERE transaction_id = ?2 AND consumed_at_utc IS NULL",
                params![now, transaction_id],
            )?;
            if updated == 0 {
                return Err(anyhow!("oauth transaction already consumed"));
            }
            Ok(Some(verifier))
        })
    }
}

fn status_str(s: CommandStatus) -> &'static str {
    match s {
        CommandStatus::Pending => "pending",
        CommandStatus::InFlight => "in_flight",
        CommandStatus::Succeeded => "succeeded",
        CommandStatus::Failed => "failed",
        CommandStatus::Conflict => "conflict",
        CommandStatus::AwaitingManualConfirmation => "awaiting_manual_confirmation",
        CommandStatus::DeadLetter => "dead_letter",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::secrets::install_test_secrets;
    use crate::connectors::ticktick::outbox::{CommandKind, WorkCommand};
    use crate::db::test_db;

    #[test]
    fn retry_once_atomic() {
        install_test_secrets();
        let db = test_db();
        let cmd = WorkCommand::with_expectations(
            "a1",
            "d1",
            CommandKind::CompleteTask {
                task_id: "t1".into(),
            },
            "hash",
            Some("content".into()),
            None,
        );
        WorkCommandStore::insert(&db, &cmd).unwrap();
        let id = cmd.command_id.to_string();
        assert!(WorkCommandStore::consume_retry_once(&db, &id).unwrap());
        assert!(!WorkCommandStore::consume_retry_once(&db, &id).unwrap());
    }
}
