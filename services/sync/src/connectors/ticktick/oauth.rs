use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PkceChallenge {
    pub code_verifier: String,
    pub code_challenge: String,
    pub method: String,
}

impl std::fmt::Debug for PkceChallenge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PkceChallenge")
            .field("code_challenge", &self.code_challenge)
            .field("method", &self.method)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorizationTransaction {
    pub transaction_id: Uuid,
    pub account_id: String,
    pub state: String,
    pub csrf_token: String,
    pub pkce: PkceChallenge,
    pub redirect_uri: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub status: AuthTransactionStatus,
}

impl std::fmt::Debug for AuthorizationTransaction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthorizationTransaction")
            .field("transaction_id", &self.transaction_id)
            .field("account_id", &self.account_id)
            .field("redirect_uri", &self.redirect_uri)
            .field("created_at", &self.created_at)
            .field("expires_at", &self.expires_at)
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthTransactionStatus {
    Pending,
    Exchanged,
    Failed,
    Expired,
}

impl AuthorizationTransaction {
    pub fn new(
        account_id: impl Into<String>,
        redirect_uri: impl Into<String>,
        ttl_secs: i64,
    ) -> Self {
        let now = Utc::now();
        let verifier = generate_code_verifier();
        let challenge = code_challenge_s256(&verifier);
        Self {
            transaction_id: Uuid::new_v4(),
            account_id: account_id.into(),
            state: Uuid::new_v4().to_string(),
            csrf_token: Uuid::new_v4().to_string(),
            pkce: PkceChallenge {
                code_verifier: verifier,
                code_challenge: challenge,
                method: "S256".into(),
            },
            redirect_uri: redirect_uri.into(),
            created_at: now,
            expires_at: now + chrono::Duration::seconds(ttl_secs),
            status: AuthTransactionStatus::Pending,
        }
    }

    pub fn validate_callback(
        &self,
        state: &str,
        csrf: &str,
    ) -> Result<(), OAuthValidationError> {
        if self.status != AuthTransactionStatus::Pending {
            return Err(OAuthValidationError::NotPending);
        }
        if Utc::now() > self.expires_at {
            return Err(OAuthValidationError::Expired);
        }
        if self.state != state {
            return Err(OAuthValidationError::StateMismatch);
        }
        if self.csrf_token != csrf {
            return Err(OAuthValidationError::CsrfMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OAuthValidationError {
    #[error("transaction not pending")]
    NotPending,
    #[error("transaction expired")]
    Expired,
    #[error("state mismatch")]
    StateMismatch,
    #[error("csrf mismatch")]
    CsrfMismatch,
}

fn generate_code_verifier() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..64)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

fn code_challenge_s256(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(verifier.as_bytes());
    base64_url_encode(&hash)
}

fn base64_url_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 63) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_deterministic() {
        let v = "test-verifier-12345";
        let c1 = code_challenge_s256(v);
        let c2 = code_challenge_s256(v);
        assert_eq!(c1, c2);
        assert!(!c1.is_empty());
    }
}
