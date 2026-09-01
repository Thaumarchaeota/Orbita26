use super::dto::{FetchResult, FetchWindow, ProbeCapabilities};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("not connected")]
    NotConnected,
    #[error("rate limited until {0}")]
    RateLimited(chrono::DateTime<chrono::Utc>),
    #[error("token invalid")]
    TokenInvalid,
    #[error("no token")]
    NoToken,
    #[error("fetch failed: {0}")]
    FetchFailed(String),
}

pub trait GarminProvider: Send + Sync {
    fn connect(&mut self, account_id: &str) -> Result<(), ProviderError>;
    fn fetch_window(&self, window: &FetchWindow) -> Result<FetchResult, ProviderError>;
    fn probe_capabilities(&self) -> Result<ProbeCapabilities, ProviderError>;
}
