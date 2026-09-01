pub mod capabilities;
pub mod enrollment;
pub mod secrets;
pub mod tokens;

use axum::async_trait;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthContext {
    pub account_id: String,
    pub device_id: String,
    pub capabilities: Vec<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub metrics: Arc<crate::metrics::Metrics>,
}

pub type SharedState = Arc<AppState>;

#[derive(Debug, Clone)]
pub struct Authenticated(pub AuthContext);

#[async_trait]
impl<S> FromRequestParts<S> for Authenticated
where
    S: Send + Sync,
    SharedState: FromRef<S>,
{
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = SharedState::from_ref(state);
        let auth_header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "missing authorization".into()))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or((StatusCode::UNAUTHORIZED, "invalid authorization scheme".into()))?;

        let ctx = tokens::verify_bearer_token(&state.db, token)
            .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
        Ok(Authenticated(ctx))
    }
}

/// Reject payloads that try to override account scope (IDOR prevention).
pub fn reject_payload_account_mismatch(
    auth: &AuthContext,
    payload_account: Option<&str>,
) -> Result<(), (StatusCode, String)> {
    if let Some(acct) = payload_account {
        if acct != auth.account_id {
            return Err((
                StatusCode::FORBIDDEN,
                "account scope mismatch".into(),
            ));
        }
    }
    Ok(())
}
