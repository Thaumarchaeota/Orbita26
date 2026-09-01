use anyhow::{anyhow, Result};
use rusqlite::OptionalExtension;

use super::secrets::hash_token;
use super::AuthContext;
use crate::db::repository::with_transaction;
use crate::db::Database;

pub fn verify_bearer_token(db: &std::sync::Arc<Database>, raw_token: &str) -> Result<AuthContext> {
    let token_hash = hash_token(raw_token)?;
    with_transaction(db, |tx| {
        let row: Option<(String, String, Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT d.account_id, d.id, dt.revoked_at_utc, dt.expires_at_utc
                 FROM device_tokens dt
                 JOIN devices d ON d.id = dt.device_id
                 WHERE dt.token_hash = ?1 AND d.status = 'active'",
                rusqlite::params![token_hash],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;

        let (account_id, device_id, revoked, expires) =
            row.ok_or_else(|| anyhow!("invalid token"))?;
        if revoked.is_some() {
            return Err(anyhow!("token revoked"));
        }
        if let Some(exp) = expires {
            let exp_dt = chrono::DateTime::parse_from_rfc3339(&exp)
                .map_err(|_| anyhow!("invalid token expiry"))?;
            if exp_dt < chrono::Utc::now() {
                return Err(anyhow!("token expired"));
            }
        }

        let mut caps_stmt =
            tx.prepare("SELECT capability FROM device_capabilities WHERE device_id = ?1")?;
        let caps = caps_stmt
            .query_map(rusqlite::params![device_id], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        Ok(AuthContext {
            account_id,
            device_id,
            capabilities: caps,
        })
    })
}

pub fn revoke_device_token(db: &std::sync::Arc<Database>, device_id: &str) -> Result<()> {
    with_transaction(db, |tx| {
        let now = crate::db::utc_now();
        tx.execute(
            "UPDATE device_tokens SET revoked_at_utc = ?1 WHERE device_id = ?2 AND revoked_at_utc IS NULL",
            rusqlite::params![now, device_id],
        )?;
        tx.execute(
            "UPDATE devices SET status = 'revoked', revoked_at_utc = ?1 WHERE id = ?2",
            rusqlite::params![now, device_id],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository::{ensure_test_account, ensure_test_device, ensure_test_device_token};
    use crate::db::test_db;
    use uuid::Uuid;

    #[test]
    fn rejects_expired_token() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let raw = "test-token-expired";
        ensure_test_device_token(&db, &account, &device, raw).unwrap();
        {
            let conn = db.conn().unwrap();
            conn.execute(
                "UPDATE device_tokens SET expires_at_utc = '2000-01-01T00:00:00Z' WHERE device_id = ?1",
                rusqlite::params![device],
            )
            .unwrap();
        }
        assert!(verify_bearer_token(&db, raw).is_err());
    }
}
