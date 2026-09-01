use std::sync::Arc;

use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;
use uuid::Uuid;

use super::{utc_now, Database};

#[derive(Debug, Clone)]
pub struct CurrentRecord {
    pub account_id: String,
    pub domain: String,
    pub record_type: String,
    pub record_id: String,
    pub server_version: i64,
    pub content_hash: String,
    pub snapshot_json: String,
    pub tombstone_json: Option<String>,
    pub natural_key_json: String,
    pub is_tombstone: bool,
    pub change_seq: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OpReceipt {
    pub op_id: String,
    pub status: String,
    pub server_version: Option<i64>,
    pub change_seq: Option<i64>,
    pub conflict_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredOpMeta {
    pub request_fingerprint: String,
    pub receipt: OpReceipt,
}

pub struct AccountRepo;

impl AccountRepo {
    pub fn ensure_account(tx: &Transaction<'_>, account_id: &str) -> Result<()> {
        let now = utc_now();
        tx.execute(
            "INSERT OR IGNORE INTO accounts(id, created_at_utc) VALUES (?1, ?2)",
            params![account_id, now],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO account_change_seq(account_id, next_seq) VALUES (?1, 1)",
            params![account_id],
        )?;
        Ok(())
    }

    pub fn next_change_seq(tx: &Transaction<'_>, account_id: &str) -> Result<i64> {
        let current: i64 = tx.query_row(
            "SELECT next_seq FROM account_change_seq WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE account_change_seq SET next_seq = next_seq + 1 WHERE account_id = ?1",
            params![account_id],
        )?;
        Ok(current)
    }
}

pub struct NaturalKeyRepo;

impl NaturalKeyRepo {
    pub fn lookup_record_id(
        tx: &Transaction<'_>,
        account_id: &str,
        record_type: &str,
        natural_key_hash: &str,
    ) -> Result<Option<String>> {
        tx.query_row(
            "SELECT record_id FROM natural_keys
             WHERE account_id = ?1 AND record_type = ?2 AND natural_key_hash = ?3",
            params![account_id, record_type, natural_key_hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn bind(
        tx: &Transaction<'_>,
        account_id: &str,
        record_type: &str,
        natural_key_hash: &str,
        record_id: &str,
    ) -> Result<()> {
        if let Some(existing) = Self::lookup_record_id(tx, account_id, record_type, natural_key_hash)?
        {
            if existing != record_id {
                return Err(anyhow!("NATURAL_KEY_COLLISION"));
            }
            return Ok(());
        }
        tx.execute(
            "INSERT INTO natural_keys(account_id, record_type, natural_key_hash, record_id)
             VALUES (?1,?2,?3,?4)",
            params![account_id, record_type, natural_key_hash, record_id],
        )?;
        Ok(())
    }

    /// Change an entity's natural-key slot inside the same SQLite transaction
    /// that writes its new version.  The unique index prevents two records from
    /// owning a fact, and deleting the old slot only after collision checking
    /// prevents a failed update from orphaning its previous identity.
    pub fn rebind(
        tx: &Transaction<'_>,
        account_id: &str,
        record_type: &str,
        record_id: &str,
        new_natural_key_hash: &str,
    ) -> Result<()> {
        if let Some(owner) = Self::lookup_record_id(
            tx,
            account_id,
            record_type,
            new_natural_key_hash,
        )? {
            if owner != record_id {
                return Err(anyhow!("NATURAL_KEY_COLLISION"));
            }
        }
        tx.execute(
            "DELETE FROM natural_keys
             WHERE account_id = ?1 AND record_type = ?2 AND record_id = ?3
               AND natural_key_hash <> ?4",
            params![account_id, record_type, record_id, new_natural_key_hash],
        )?;
        Self::bind(
            tx,
            account_id,
            record_type,
            new_natural_key_hash,
            record_id,
        )
    }
}

pub struct RecordRepo;

impl RecordRepo {
    pub fn get_current(
        tx: &Transaction<'_>,
        account_id: &str,
        domain: &str,
        record_type: &str,
        record_id: &str,
    ) -> Result<Option<CurrentRecord>> {
        tx.query_row(
            "SELECT account_id, domain, record_type, record_id, server_version, content_hash,
                    snapshot_json, tombstone_json, natural_key_json, is_tombstone, change_seq
             FROM current_records
             WHERE account_id = ?1 AND domain = ?2 AND record_type = ?3 AND record_id = ?4",
            params![account_id, domain, record_type, record_id],
            |row| {
                Ok(CurrentRecord {
                    account_id: row.get(0)?,
                    domain: row.get(1)?,
                    record_type: row.get(2)?,
                    record_id: row.get(3)?,
                    server_version: row.get(4)?,
                    content_hash: row.get(5)?,
                    snapshot_json: row.get(6)?,
                    tombstone_json: row.get(7)?,
                    natural_key_json: row.get(8)?,
                    is_tombstone: row.get::<_, i64>(9)? != 0,
                    change_seq: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn insert_version(
        tx: &Transaction<'_>,
        account_id: &str,
        domain: &str,
        record_type: &str,
        record_id: &str,
        server_version: i64,
        kind: &str,
        content_hash: &str,
        snapshot_json: Option<&str>,
        tombstone_json: Option<&str>,
        natural_key_json: &str,
        is_tombstone: bool,
        change_seq: i64,
        op_id: &str,
        device_id: Option<&str>,
    ) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = utc_now();
        tx.execute(
            "INSERT INTO record_versions(
                id, account_id, domain, record_type, record_id, server_version, kind,
                content_hash, snapshot_json, tombstone_json, natural_key_json,
                is_tombstone, change_seq, op_id, device_id, created_at_utc
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                id,
                account_id,
                domain,
                record_type,
                record_id,
                server_version,
                kind,
                content_hash,
                snapshot_json,
                tombstone_json,
                natural_key_json,
                if is_tombstone { 1 } else { 0 },
                change_seq,
                op_id,
                device_id,
                now
            ],
        )?;
        Ok(())
    }

    pub fn upsert_current(
        tx: &Transaction<'_>,
        account_id: &str,
        domain: &str,
        record_type: &str,
        record_id: &str,
        server_version: i64,
        content_hash: &str,
        snapshot_json: &str,
        tombstone_json: Option<&str>,
        natural_key_json: &str,
        is_tombstone: bool,
        change_seq: i64,
    ) -> Result<()> {
        let now = utc_now();
        tx.execute(
            "INSERT INTO current_records(
                account_id, domain, record_type, record_id, server_version, content_hash,
                snapshot_json, tombstone_json, natural_key_json, is_tombstone, change_seq, updated_at_utc
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
            ON CONFLICT(account_id, domain, record_type, record_id) DO UPDATE SET
                server_version = excluded.server_version,
                content_hash = excluded.content_hash,
                snapshot_json = excluded.snapshot_json,
                tombstone_json = excluded.tombstone_json,
                natural_key_json = excluded.natural_key_json,
                is_tombstone = excluded.is_tombstone,
                change_seq = excluded.change_seq,
                updated_at_utc = excluded.updated_at_utc",
            params![
                account_id,
                domain,
                record_type,
                record_id,
                server_version,
                content_hash,
                snapshot_json,
                tombstone_json,
                natural_key_json,
                if is_tombstone { 1 } else { 0 },
                change_seq,
                now
            ],
        )?;
        Ok(())
    }

    pub fn insert_conflict(
        tx: &Transaction<'_>,
        account_id: &str,
        domain: &str,
        record_type: &str,
        record_id: &str,
        server_version: i64,
        client_base_version: Option<i64>,
        client_content_hash: &str,
        client_snapshot_json: &str,
        server_content_hash: &str,
        server_snapshot_json: &str,
        device_id: &str,
        op_id: &str,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = utc_now();
        tx.execute(
            "INSERT INTO conflicts(
                id, account_id, domain, record_type, record_id, server_version,
                client_base_version, client_content_hash, client_snapshot_json,
                server_content_hash, server_snapshot_json, device_id, op_id, created_at_utc
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                id,
                account_id,
                domain,
                record_type,
                record_id,
                server_version,
                client_base_version,
                client_content_hash,
                client_snapshot_json,
                server_content_hash,
                server_snapshot_json,
                device_id,
                op_id,
                now
            ],
        )?;
        Ok(id)
    }
}

#[derive(Debug, Clone)]
pub struct ConflictRow {
    pub id: String,
    pub account_id: String,
    pub domain: String,
    pub record_type: String,
    pub record_id: String,
    pub server_version: i64,
    pub status: String,
}

pub struct ConflictRepo;

impl ConflictRepo {
    pub fn get_open(
        tx: &Transaction<'_>,
        account_id: &str,
        conflict_id: &str,
    ) -> Result<Option<ConflictRow>> {
        tx.query_row(
            "SELECT id, account_id, domain, record_type, record_id, server_version, status
             FROM conflicts WHERE id = ?1 AND account_id = ?2",
            params![conflict_id, account_id],
            |row| {
                Ok(ConflictRow {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    domain: row.get(2)?,
                    record_type: row.get(3)?,
                    record_id: row.get(4)?,
                    server_version: row.get(5)?,
                    status: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn close(
        tx: &Transaction<'_>,
        account_id: &str,
        conflict_id: &str,
    ) -> Result<()> {
        let now = utc_now();
        let rows = tx.execute(
            "UPDATE conflicts SET status = 'resolved', resolved_at_utc = ?1
             WHERE id = ?2 AND account_id = ?3 AND status = 'open'",
            params![now, conflict_id, account_id],
        )?;
        if rows == 0 {
            return Err(anyhow!("conflict not open or not found"));
        }
        Ok(())
    }
}

pub struct OperationRepo;

impl OperationRepo {
    pub fn find_receipt(
        tx: &Transaction<'_>,
        account_id: &str,
        op_id: &str,
    ) -> Result<Option<StoredOpMeta>> {
        tx.query_row(
            "SELECT request_fingerprint, op_id, status, result_json FROM operations
             WHERE account_id = ?1 AND op_id = ?2",
            params![account_id, op_id],
            |row| {
                let result_json: Option<String> = row.get(3)?;
                let mut receipt = OpReceipt {
                    op_id: row.get(1)?,
                    status: row.get(2)?,
                    server_version: None,
                    change_seq: None,
                    conflict_id: None,
                };
                if let Some(json) = result_json {
                    if let Ok(v) = serde_json::from_str::<Value>(&json) {
                        receipt.server_version = v.get("server_version").and_then(|x| x.as_i64());
                        receipt.change_seq = v.get("change_seq").and_then(|x| x.as_i64());
                        receipt.conflict_id = v
                            .get("conflict_id")
                            .and_then(|x| x.as_str())
                            .map(str::to_string);
                    }
                }
                Ok(StoredOpMeta {
                    request_fingerprint: row.get(0)?,
                    receipt,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn store_receipt(
        tx: &Transaction<'_>,
        account_id: &str,
        op_id: &str,
        device_id: &str,
        request_fingerprint: &str,
        status: &str,
        receipt: &OpReceipt,
        correlation_id: Option<&str>,
    ) -> Result<()> {
        let now = utc_now();
        let result_json = serde_json::to_string(receipt)?;
        let rows = tx.execute(
            "INSERT INTO operations(account_id, op_id, device_id, request_fingerprint, status, result_json, created_at_utc, processed_at_utc, correlation_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(account_id, op_id) DO NOTHING",
            params![
                account_id,
                op_id,
                device_id,
                request_fingerprint,
                status,
                result_json,
                now,
                now,
                correlation_id
            ],
        )?;
        if rows == 0 {
            return Err(anyhow!("op_id already stored"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct VersionRow {
    pub domain: String,
    pub record_type: String,
    pub record_id: String,
    pub server_version: i64,
    pub kind: String,
    pub content_hash: String,
    pub snapshot_json: Option<String>,
    pub tombstone_json: Option<String>,
    pub natural_key_json: String,
    pub is_tombstone: bool,
    pub change_seq: i64,
    pub op_id: String,
    pub created_at_utc: String,
}

pub struct PullRepo;

impl PullRepo {
    pub fn changes_since(
        tx: &Transaction<'_>,
        account_id: &str,
        after_seq: i64,
        limit: usize,
    ) -> Result<Vec<VersionRow>> {
        let mut stmt = tx.prepare(
            "SELECT domain, record_type, record_id, server_version, kind, content_hash,
                    snapshot_json, tombstone_json, natural_key_json, is_tombstone, change_seq, op_id, created_at_utc
             FROM record_versions
             WHERE account_id = ?1 AND change_seq > ?2
             ORDER BY change_seq ASC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![account_id, after_seq, limit as i64], |row| {
            Ok(VersionRow {
                domain: row.get(0)?,
                record_type: row.get(1)?,
                record_id: row.get(2)?,
                server_version: row.get(3)?,
                kind: row.get(4)?,
                content_hash: row.get(5)?,
                snapshot_json: row.get(6)?,
                tombstone_json: row.get(7)?,
                natural_key_json: row.get(8)?,
                is_tombstone: row.get::<_, i64>(9)? != 0,
                change_seq: row.get(10)?,
                op_id: row.get(11)?,
                created_at_utc: row.get(12)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn max_change_seq(tx: &Transaction<'_>, account_id: &str) -> Result<i64> {
        let seq: Option<i64> = tx
            .query_row(
                "SELECT MAX(change_seq) FROM record_versions WHERE account_id = ?1",
                params![account_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        Ok(seq.unwrap_or(0))
    }

    pub fn ack_delivery(
        tx: &Transaction<'_>,
        account_id: &str,
        device_id: &str,
        delivered_change_seq: i64,
    ) -> Result<()> {
        let now = utc_now();
        tx.execute(
            "INSERT INTO delivery_acks(account_id, device_id, delivered_change_seq, updated_at_utc)
             VALUES (?1,?2,?3,?4)
             ON CONFLICT(account_id, device_id) DO UPDATE SET
                delivered_change_seq = MAX(delivery_acks.delivered_change_seq, excluded.delivered_change_seq),
                updated_at_utc = excluded.updated_at_utc",
            params![account_id, device_id, delivered_change_seq, now],
        )?;
        Ok(())
    }

    pub fn mark_issued(
        tx: &Transaction<'_>,
        account_id: &str,
        device_id: &str,
        issued_change_seq: i64,
    ) -> Result<()> {
        let now = utc_now();
        tx.execute(
            "INSERT INTO delivery_issued(account_id, device_id, issued_change_seq, updated_at_utc)
             VALUES (?1,?2,?3,?4)
             ON CONFLICT(account_id, device_id) DO UPDATE SET
                issued_change_seq = MAX(delivery_issued.issued_change_seq, excluded.issued_change_seq),
                updated_at_utc = excluded.updated_at_utc",
            params![account_id, device_id, issued_change_seq, now],
        )?;
        Ok(())
    }

    pub fn max_issued_seq(
        tx: &Transaction<'_>,
        account_id: &str,
        device_id: &str,
    ) -> Result<i64> {
        let issued = tx
            .query_row(
                "SELECT issued_change_seq FROM delivery_issued
                 WHERE account_id = ?1 AND device_id = ?2",
                params![account_id, device_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(issued.unwrap_or(0))
    }

    pub fn acknowledged_seq(
        tx: &Transaction<'_>,
        account_id: &str,
        device_id: &str,
    ) -> Result<i64> {
        let acknowledged = tx
            .query_row(
                "SELECT delivered_change_seq FROM delivery_acks
                 WHERE account_id = ?1 AND device_id = ?2",
                params![account_id, device_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(acknowledged.unwrap_or(0))
    }

    pub fn min_delivered_seq(tx: &Transaction<'_>, account_id: &str) -> Result<i64> {
        let seq: Option<i64> = tx
            .query_row(
                "SELECT MIN(delivered_change_seq) FROM delivery_acks WHERE account_id = ?1",
                params![account_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        Ok(seq.unwrap_or(0))
    }
}

pub fn with_transaction<F, T>(db: &Arc<Database>, f: F) -> Result<T>
where
    F: FnOnce(&Transaction<'_>) -> Result<T>,
{
    let mut guard = db.conn()?;
    let tx = guard.transaction()?;
    let out = f(&tx)?;
    tx.commit()?;
    Ok(out)
}

pub async fn with_transaction_async<F, T>(db: Arc<Database>, f: F) -> Result<T>
where
    F: FnOnce(&Transaction<'_>) -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || with_transaction(&db, f))
        .await
        .map_err(|e| anyhow!("db worker join: {e}"))?
}

pub fn ensure_test_account(db: &Arc<Database>, account_id: &str) -> Result<()> {
    with_transaction(db, |tx| AccountRepo::ensure_account(tx, account_id))
}

pub fn ensure_test_device(db: &Arc<Database>, account_id: &str, device_id: &str) -> Result<()> {
    with_transaction(db, |tx| {
        AccountRepo::ensure_account(tx, account_id)?;
        let now = utc_now();
        tx.execute(
            "INSERT OR IGNORE INTO devices(id, account_id, created_at_utc) VALUES (?1,?2,?3)",
            params![device_id, account_id, now],
        )?;
        Ok(())
    })
}

pub fn ensure_test_device_token(
    db: &Arc<Database>,
    account_id: &str,
    device_id: &str,
    raw_token: &str,
) -> Result<()> {
    ensure_test_device(db, account_id, device_id)?;
    let token_hash = crate::auth::secrets::hash_token(raw_token)?;
    with_transaction(db, |tx| {
        let token_id = Uuid::new_v4().to_string();
        let now = utc_now();
        let expires = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
        tx.execute(
            "INSERT INTO device_tokens(id, device_id, token_hash, created_at_utc, expires_at_utc)
             VALUES (?1,?2,?3,?4,?5)",
            params![token_id, device_id, token_hash, now, expires],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO device_capabilities(device_id, capability, granted_at_utc)
             VALUES (?1,'sync',?2)",
            params![device_id, now],
        )?;
        Ok(())
    })
}
