use std::sync::Arc;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use crate::config::Config;
use crate::db::migrations::migration_version;
use crate::db::Database;

#[derive(Debug, Serialize)]
pub struct LiveResponse {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyResponse {
    pub status: &'static str,
    pub migration_version: i64,
    pub db_ok: bool,
    pub disk_ok: bool,
    pub backup_fresh: bool,
}

pub async fn live() -> impl IntoResponse {
    Json(LiveResponse { status: "ok" })
}

pub async fn ready(db: Arc<Database>, config: Arc<Config>) -> impl IntoResponse {
    let migration_ver = migration_version(&db).unwrap_or(0);
    let db_ok = db.conn().is_ok()
        && migration_ver > 0
        && db
            .conn()
            .ok()
            .and_then(|c| c.execute("SELECT 1", []).ok())
            .is_some();
    let disk_ok = config.disk_free_ok();
    let backup_fresh = config.backup_fresh();

    let ready = db_ok && disk_ok && backup_fresh;
    let status = if ready { "ok" } else { "degraded" };
    let code = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        code,
        Json(ReadyResponse {
            status,
            migration_version: migration_ver,
            db_ok,
            disk_ok,
            backup_fresh,
        }),
    )
}
