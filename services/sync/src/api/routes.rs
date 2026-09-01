use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::limit::RequestBodyLimitLayer;

use crate::api::diagnostics;
use crate::auth::capabilities::require_sync;
use crate::auth::enrollment::consume_invite;
use crate::auth::tokens::revoke_device_token;
use crate::auth::{Authenticated, SharedState};
use crate::config::Config;
use crate::health;
use crate::redaction::redact_sync_request_summary;
use crate::sync::errors::{ApiError, SyncErrorCode};
use crate::sync::limits::MAX_BODY_BYTES;
use crate::sync::{ack_delivery, apply_push_ops, pull_changes, AckRequest, PullRequest, PushRequest};

#[derive(Serialize)]
pub(crate) struct ErrorResponse {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    retryable: Option<bool>,
    #[serde(rename = "clientAction", skip_serializing_if = "Option::is_none")]
    client_action: Option<String>,
}

pub fn router(state: SharedState, config: Arc<Config>) -> Router {
    Router::new()
        .route("/health/live", get(health::live))
        .route(
            "/health/ready",
            get({
                let db = state.db.clone();
                let cfg = config.clone();
                move || ready_handler(db.clone(), cfg.clone())
            }),
        )
        .route("/metrics", get({
            let metrics = state.metrics.clone();
            move |headers: HeaderMap| {
                let metrics = metrics.clone();
                async move { metrics_handler(headers, metrics) }
            }
        }))
        .route("/v1/sync/push", post(push_handler))
        .route("/v1/sync/pull", post(pull_handler))
        .route("/v1/sync/ack", post(ack_handler))
        .route("/v1/devices/enroll", post(enroll_handler))
        .route("/v1/devices/revoke", post(revoke_handler))
        .route(
            "/v1/support/operations/:op_id/timeline",
            get(diagnostics::operation_timeline_handler),
        )
        .route(
            "/v1/support/diagnostics/bundle",
            get(diagnostics::diagnostics_bundle_handler),
        )
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .with_state(state)
}

async fn ready_handler(
    db: Arc<crate::db::Database>,
    config: Arc<Config>,
) -> impl axum::response::IntoResponse {
    health::ready(db, config).await
}

fn metrics_handler(
    headers: HeaderMap,
    metrics: Arc<crate::metrics::Metrics>,
) -> Result<String, StatusCode> {
    let token = headers
        .get("x-metrics-token")
        .and_then(|v| v.to_str().ok());
    if !Config::metrics_allowed(token) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(metrics.render_prometheus())
}

pub(crate) fn map_api_error(e: ApiError) -> (StatusCode, Json<ErrorResponse>) {
    tracing::warn!(code = e.code.as_str(), detail = %e.message, "api error");
    (
        e.code.http_status(),
        Json(ErrorResponse {
            code: e.code.as_str().to_string(),
            message: e.message,
            retryable: Some(e.code.retryable()),
            client_action: Some(e.code.client_action().to_string()),
        }),
    )
}

fn correlation_id_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-correlation-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

async fn push_handler(
    State(state): State<SharedState>,
    auth: Authenticated,
    headers: HeaderMap,
    Json(req): Json<PushRequest>,
) -> Result<Json<crate::sync::PushResponse>, (StatusCode, Json<ErrorResponse>)> {
    require_sync(&auth.0).map_err(|e| {
        map_api_error(ApiError::new(SyncErrorCode::UnauthorizedGarmin, e))
    })?;
    tracing::info!(
        account = %crate::redaction::hash_id(&auth.0.account_id),
        device = %crate::redaction::hash_id(&auth.0.device_id),
        op_count = req.changes.len(),
        "{}",
        redact_sync_request_summary("push", &req)
    );
    let db = state.db.clone();
    let auth_ctx = auth.0.clone();
    let metrics = state.metrics.clone();
    let correlation_id = correlation_id_from_headers(&headers);
    tokio::task::spawn_blocking(move || {
        apply_push_ops(&db, &auth_ctx, req, &metrics, correlation_id)
    })
        .await
        .map_err(|e| {
            state.metrics.inc_error();
            tracing::error!(error = %e, "push join failed");
            map_api_error(ApiError::new(SyncErrorCode::Internal, "push failed"))
        })?
        .map(Json)
        .map_err(|e| {
            state.metrics.inc_error();
            tracing::error!(error = %e, "push failed");
            map_api_error(ApiError::new(SyncErrorCode::Internal, "push failed"))
        })
}

async fn pull_handler(
    State(state): State<SharedState>,
    auth: Authenticated,
    headers: HeaderMap,
    Json(req): Json<PullRequest>,
) -> Result<Json<crate::sync::PullResponse>, (StatusCode, Json<ErrorResponse>)> {
    require_sync(&auth.0).map_err(|e| {
        map_api_error(ApiError::new(SyncErrorCode::UnauthorizedGarmin, e))
    })?;
    tracing::info!(
        account = %crate::redaction::hash_id(&auth.0.account_id),
        device = %crate::redaction::hash_id(&auth.0.device_id),
        cursor = req.cursor,
        "pull"
    );
    let db = state.db.clone();
    let auth_ctx = auth.0.clone();
    let metrics = state.metrics.clone();
    let correlation_id = correlation_id_from_headers(&headers);
    tokio::task::spawn_blocking(move || {
        pull_changes(&db, &auth_ctx, req, &metrics, correlation_id)
    })
        .await
        .map_err(|e| {
            state.metrics.inc_error();
            tracing::error!(error = %e, "pull join failed");
            map_api_error(ApiError::new(SyncErrorCode::Internal, "pull failed"))
        })?
        .map(Json)
        .map_err(|e| {
            state.metrics.inc_error();
            tracing::error!(error = %e, "pull failed");
            map_api_error(ApiError::new(SyncErrorCode::ValidationFailed, "invalid pull request"))
        })
}

async fn ack_handler(
    State(state): State<SharedState>,
    auth: Authenticated,
    headers: HeaderMap,
    Json(req): Json<AckRequest>,
) -> Result<Json<crate::sync::AckResponse>, (StatusCode, Json<ErrorResponse>)> {
    require_sync(&auth.0).map_err(|e| {
        map_api_error(ApiError::new(SyncErrorCode::UnauthorizedGarmin, e))
    })?;
    let db = state.db.clone();
    let auth_ctx = auth.0.clone();
    let correlation_id = correlation_id_from_headers(&headers);
    tokio::task::spawn_blocking(move || ack_delivery(&db, &auth_ctx, req, correlation_id))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "ack join failed");
            map_api_error(ApiError::new(SyncErrorCode::Internal, "ack failed"))
        })?
        .map(Json)
        .map_err(|e| {
            state.metrics.inc_error();
            tracing::error!(error = %e, "ack failed");
            map_api_error(ApiError::new(SyncErrorCode::ValidationFailed, "invalid ack request"))
        })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollRequest {
    pub invite_code: String,
    #[serde(default)]
    pub device_label: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub device_id: String,
    pub token: String,
}

async fn enroll_handler(
    State(state): State<SharedState>,
    Json(req): Json<EnrollRequest>,
) -> Result<Json<EnrollResponse>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.clone();
    let invite_code = req.invite_code.clone();
    let device_label = req.device_label.clone();
    tokio::task::spawn_blocking(move || consume_invite(&db, &invite_code, device_label.as_deref()))
    .await
    .map_err(|e| map_api_error(ApiError::new(SyncErrorCode::Internal, e.to_string())))?
    .map(|d| {
        Json(EnrollResponse {
            device_id: d.device_id,
            token: d.token,
        })
    })
    .map_err(|e| map_api_error(ApiError::new(SyncErrorCode::ValidationFailed, e.to_string())))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeRequest {
    pub device_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeResponse {
    pub device_id: String,
    pub revoked: bool,
}

async fn revoke_handler(
    State(state): State<SharedState>,
    auth: Authenticated,
    Json(req): Json<RevokeRequest>,
) -> Result<Json<RevokeResponse>, (StatusCode, Json<ErrorResponse>)> {
    if req.device_id != auth.0.device_id {
        return Err(map_api_error(ApiError::new(
            SyncErrorCode::UnauthorizedGarmin,
            "can only revoke own device via this endpoint",
        )));
    }
    let db = state.db.clone();
    let device_id = req.device_id.clone();
    tokio::task::spawn_blocking(move || revoke_device_token(&db, &device_id))
        .await
        .map_err(|e| map_api_error(ApiError::new(SyncErrorCode::Internal, e.to_string())))?
        .map(|_| {
            Json(RevokeResponse {
                device_id: req.device_id,
                revoked: true,
            })
        })
        .map_err(|e| map_api_error(ApiError::new(SyncErrorCode::Internal, e.to_string())))
}
