use anyhow::{anyhow, Result};
use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::auth::secrets::hash_invite_code;
use crate::db::repository::with_transaction;
use crate::db::{utc_now, Database};

pub struct EnrollmentInvite {
    pub id: String,
    pub account_id: String,
    pub expires_at_utc: String,
}

pub fn create_invite(
    db: &std::sync::Arc<Database>,
    account_id: &str,
    ttl_hours: i64,
) -> Result<(String, EnrollmentInvite)> {
    if !(1..=168).contains(&ttl_hours) {
        return Err(anyhow!("ttl_hours must be between 1 and 168"));
    }
    let code = Uuid::new_v4().to_string();
    let hash = hash_invite_code(&code)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let expires = now + Duration::hours(ttl_hours);
    let expires_at = expires.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let created = utc_now();

    with_transaction(db, |tx| {
        crate::db::repository::AccountRepo::ensure_account(tx, account_id)?;
        tx.execute(
            "INSERT INTO enrollment_invites(id, account_id, invite_hash, created_at_utc, expires_at_utc)
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![id, account_id, hash, created, expires_at],
        )?;
        Ok(())
    })?;

    Ok((
        code,
        EnrollmentInvite {
            id,
            account_id: account_id.to_string(),
            expires_at_utc: expires_at,
        },
    ))
}

pub struct EnrolledDevice {
    pub device_id: String,
    pub token: String,
}

pub fn consume_invite(
    db: &std::sync::Arc<Database>,
    invite_code: &str,
    device_label: Option<&str>,
) -> Result<EnrolledDevice> {
    let hash = hash_invite_code(invite_code)?;
    let device_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().to_string();
    let token_hash = super::secrets::hash_token(&token)?;
    let token_id = Uuid::new_v4().to_string();
    let now = utc_now();
    let token_expires = (Utc::now() + Duration::days(365))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    with_transaction(db, |tx| {
        let row: Option<(String, String, Option<String>)> = tx
            .query_row(
                "SELECT id, account_id, consumed_at_utc FROM enrollment_invites WHERE invite_hash = ?1",
                rusqlite::params![hash],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;

        let (invite_id, account_id, consumed) =
            row.ok_or_else(|| anyhow!("invalid invite"))?;
        if consumed.is_some() {
            return Err(anyhow!("invite already consumed"));
        }
        let expires: String = tx.query_row(
            "SELECT expires_at_utc FROM enrollment_invites WHERE id = ?1",
            rusqlite::params![invite_id],
            |row| row.get(0),
        )?;
        let exp = chrono::DateTime::parse_from_rfc3339(&expires)
            .map_err(|_| anyhow!("invalid invite expiry"))?;
        if exp < Utc::now() {
            return Err(anyhow!("invite expired"));
        }

        crate::db::repository::AccountRepo::ensure_account(tx, &account_id)?;
        tx.execute(
            "INSERT INTO devices(id, account_id, label, created_at_utc) VALUES (?1,?2,?3,?4)",
            rusqlite::params![device_id, account_id, device_label, now],
        )?;
        tx.execute(
            "INSERT INTO device_tokens(id, device_id, token_hash, created_at_utc, expires_at_utc)
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![token_id, device_id, token_hash, now, token_expires],
        )?;
        tx.execute(
            "INSERT INTO device_capabilities(device_id, capability, granted_at_utc) VALUES (?1,'sync',?2)",
            rusqlite::params![device_id, now],
        )?;
        tx.execute(
            "UPDATE enrollment_invites SET consumed_at_utc = ?1, consumed_device_id = ?2 WHERE id = ?3",
            rusqlite::params![now, device_id, invite_id],
        )?;
        Ok(())
    })?;

    Ok(EnrolledDevice { device_id, token })
}

use rusqlite::OptionalExtension;
