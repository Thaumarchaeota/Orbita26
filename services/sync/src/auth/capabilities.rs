use crate::auth::AuthContext;

pub const CAP_SYNC: &str = "sync";
pub const CAP_GARMIN_COLLECT: &str = "garmin_collect";

pub fn has_capability(ctx: &AuthContext, capability: &str) -> bool {
    ctx.capabilities.iter().any(|c| c == capability)
}

pub fn require_sync(ctx: &AuthContext) -> Result<(), String> {
    if has_capability(ctx, CAP_SYNC) {
        Ok(())
    } else {
        Err("missing sync capability".into())
    }
}

pub fn can_write_garmin(ctx: &AuthContext, source: &str) -> bool {
    if source != "garmin" {
        return true;
    }
    has_capability(ctx, CAP_GARMIN_COLLECT)
}

pub fn grant_capability(
    tx: &rusqlite::Transaction<'_>,
    device_id: &str,
    capability: &str,
) -> rusqlite::Result<()> {
    let now = crate::db::utc_now();
    tx.execute(
        "INSERT OR IGNORE INTO device_capabilities(device_id, capability, granted_at_utc) VALUES (?1,?2,?3)",
        rusqlite::params![device_id, capability, now],
    )?;
    Ok(())
}
