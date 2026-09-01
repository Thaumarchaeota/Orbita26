use chrono::{DateTime, Utc};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct EncryptedCredential {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub key_id: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("credential not found")]
    NotFound,
    #[error("credential revoked")]
    Revoked,
    #[error("encryption failed: {0}")]
    EncryptFailed(String),
    #[error("decryption failed: {0}")]
    DecryptFailed(String),
}

pub trait CredentialVault: Send + Sync {
    fn encrypt(
        &self,
        account_id: &str,
        plaintext: &[u8],
        scopes: &[String],
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<EncryptedCredential, CredentialError>;

    fn decrypt(
        &self,
        account_id: &str,
        cred: &EncryptedCredential,
    ) -> Result<Vec<u8>, CredentialError>;

    fn revoke(&mut self, account_id: &str) -> Result<(), CredentialError>;
}

#[cfg(test)]
pub mod test_vault {
    use super::*;

    /// Test-only vault. Never use in production paths.
    pub struct MockCredentialVault {
        store: std::collections::HashMap<String, EncryptedCredential>,
        revoked: std::collections::HashSet<String>,
    }

    impl MockCredentialVault {
        pub fn new() -> Self {
            Self {
                store: std::collections::HashMap::new(),
                revoked: std::collections::HashSet::new(),
            }
        }
    }

    impl Default for MockCredentialVault {
        fn default() -> Self {
            Self::new()
        }
    }

    impl CredentialVault for MockCredentialVault {
        fn encrypt(
            &self,
            account_id: &str,
            plaintext: &[u8],
            scopes: &[String],
            expires_at: Option<DateTime<Utc>>,
        ) -> Result<EncryptedCredential, CredentialError> {
            if self.revoked.contains(account_id) {
                return Err(CredentialError::Revoked);
            }
            Ok(EncryptedCredential {
                ciphertext: plaintext.to_vec(),
                nonce: vec![0u8; 12],
                key_id: "mock-key-v1".into(),
                expires_at,
                scopes: scopes.to_vec(),
            })
        }

        fn decrypt(
            &self,
            account_id: &str,
            cred: &EncryptedCredential,
        ) -> Result<Vec<u8>, CredentialError> {
            if self.revoked.contains(account_id) {
                return Err(CredentialError::Revoked);
            }
            Ok(cred.ciphertext.clone())
        }

        fn revoke(&mut self, account_id: &str) -> Result<(), CredentialError> {
            self.revoked.insert(account_id.to_string());
            self.store.remove(account_id);
            Ok(())
        }
    }
}
