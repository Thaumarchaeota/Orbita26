use anyhow::{anyhow, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::config::{Config, SecretRef, SECRET_ENROLLMENT_PEPPER, SECRET_TOKEN_PEPPER};

type HmacSha256 = Hmac<Sha256>;

#[cfg(test)]
pub const INSECURE_SECRETS_ENV: &str = "ORBITA_SYNC_ALLOW_INSECURE_SECRETS";

pub fn validate_required_secrets() -> Result<()> {
    require_hmac_secret(&SECRET_TOKEN_PEPPER)?;
    require_hmac_secret(&SECRET_ENROLLMENT_PEPPER)?;
    Ok(())
}

pub fn require_hmac_secret(ref_spec: &SecretRef) -> Result<String> {
    let secret = Config::read_secret(ref_spec)?
        .ok_or_else(|| anyhow!("missing required secret: {}", ref_spec.name))?;
    Ok(secret)
}

pub fn hmac_digest(secret: &str, message: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts arbitrary key length");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn hash_with_pepper(ref_spec: &SecretRef, raw: &str) -> Result<String> {
    #[cfg(test)]
    if std::env::var(INSECURE_SECRETS_ENV).ok().as_deref() == Some("1") {
        return Ok(hmac_digest("orbita-sync-test-pepper", raw));
    }
    let pepper = require_hmac_secret(ref_spec)?;
    Ok(hmac_digest(&pepper, raw))
}

pub fn hash_token(raw: &str) -> Result<String> {
    hash_with_pepper(&SECRET_TOKEN_PEPPER, raw)
}

pub fn hash_invite_code(raw: &str) -> Result<String> {
    hash_with_pepper(&SECRET_ENROLLMENT_PEPPER, raw)
}

#[cfg(test)]
pub fn install_test_secrets() {
    let dir = tempfile::tempdir().expect("tempdir");
    let enroll = dir.path().join("enroll.pepper");
    let token = dir.path().join("token.pepper");
    std::fs::write(&enroll, "test-enrollment-pepper").unwrap();
    std::fs::write(&token, "test-token-pepper").unwrap();
    std::env::set_var(SECRET_ENROLLMENT_PEPPER.path_env, enroll);
    std::env::set_var(SECRET_TOKEN_PEPPER.path_env, token);
    std::mem::forget(dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_is_deterministic() {
        let a = hmac_digest("pepper", "token");
        let b = hmac_digest("pepper", "token");
        assert_eq!(a, b);
        assert_ne!(a, hmac_digest("pepper", "other"));
    }

    #[test]
    fn rejects_missing_secrets_without_insecure_flag() {
        std::env::remove_var(INSECURE_SECRETS_ENV);
        std::env::remove_var(crate::config::SECRET_TOKEN_PEPPER.path_env);
        std::env::remove_var(crate::config::SECRET_ENROLLMENT_PEPPER.path_env);
        assert!(validate_required_secrets().is_err());
    }

    #[test]
    fn accepts_file_secrets() {
        install_test_secrets();
        assert!(validate_required_secrets().is_ok());
    }
}
