use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::auth::{Authenticated, SharedState};
use crate::diagnostics::{build_bundle, SafeTimelineEvent, TimelineRepo};
use crate::sync::errors::{ApiError, SyncErrorCode};

const CAP_SUPPORT_DIAGNOSTICS: &str = "support_diagnostics";

fn require_support_diagnostics(auth: &crate::auth::AuthContext) -> Result<(), String> {
    if auth.capabilities.iter().any(|capability| capability == CAP_SUPPORT_DIAGNOSTICS) {
        Ok(())
    } else {
        Err("missing support diagnostics capability".into())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleQuery {
    pub op_id: Option<String>,
}

pub async fn operation_timeline_handler(
    State(state): State<SharedState>,
    auth: Authenticated,
    axum::extract::Path(op_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<super::routes::ErrorResponse>)> {
    // A regular device token is intentionally insufficient: operation events are
    // account-scoped until the device-ownership relation is persisted and checked.
    require_support_diagnostics(&auth.0).map_err(|e| {
        super::routes::map_api_error(ApiError::new(SyncErrorCode::UnauthorizedGarmin, e))
    })?;
    let db = state.db.clone();
    let account_id = auth.0.account_id.clone();
    let op_id_for_response = op_id.clone();
    let events = tokio::task::spawn_blocking(move || {
        TimelineRepo::query_timeline(db.as_ref(), &account_id, &op_id)
    })
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "timeline join failed");
            super::routes::map_api_error(ApiError::new(SyncErrorCode::Internal, "timeline query failed"))
        })?
        .map_err(|e| {
            tracing::error!(error = %e, "timeline query failed");
            super::routes::map_api_error(ApiError::new(SyncErrorCode::Internal, "timeline query failed"))
        })?;
    let events: Vec<SafeTimelineEvent> = events.into_iter().map(SafeTimelineEvent::from).collect();
    Ok(Json(serde_json::json!({ "opId": op_id_for_response, "events": events })))
}

pub async fn diagnostics_bundle_handler(
    State(state): State<SharedState>,
    auth: Authenticated,
    Query(query): Query<BundleQuery>,
) -> Result<Json<crate::diagnostics::DiagnosticsBundle>, (StatusCode, Json<super::routes::ErrorResponse>)> {
    require_support_diagnostics(&auth.0).map_err(|e| {
        super::routes::map_api_error(ApiError::new(SyncErrorCode::UnauthorizedGarmin, e))
    })?;
    let db: Arc<crate::db::Database> = state.db.clone();
    let account_id = auth.0.account_id.clone();
    let op_id = query.op_id.clone().ok_or_else(|| {
        super::routes::map_api_error(ApiError::new(
            SyncErrorCode::ValidationFailed,
            "diagnostics bundle requires an operation id",
        ))
    })?;
    let bundle = tokio::task::spawn_blocking(move || {
        build_bundle(db.as_ref(), &account_id, Some(&op_id))
    })
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "bundle join failed");
        super::routes::map_api_error(ApiError::new(SyncErrorCode::Internal, "bundle export failed"))
    })?
    .map_err(|e| {
        tracing::error!(error = %e, "bundle export failed");
        super::routes::map_api_error(ApiError::new(SyncErrorCode::Internal, "bundle export failed"))
    })?;
    Ok(Json(bundle))
}
