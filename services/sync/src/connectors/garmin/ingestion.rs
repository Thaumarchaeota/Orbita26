use super::dto::FetchResult;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IngestionError {
    #[error("duplicate external key: {0}")]
    DuplicateKey(String),
    #[error("observe-only mode: writes rejected")]
    ObserveOnly,
    #[error("unauthorized principal")]
    Unauthorized,
    #[error("ingestion failed: {0}")]
    Failed(String),
}

pub struct IngestReceipt {
    pub accepted: u32,
    pub deduped: u32,
    pub rejected: u32,
}

/// The only fact-writing boundary for a server-side Garmin worker.
///
/// `GarminWritePermit` has private fields and is minted only by `GarminRunner`
/// after a current lease, fencing token, fetch principal, and cutover phase have
/// all been checked.  A future persistent sink must accept this permit instead of
/// accepting caller-controlled `origin` or `IngestMode` values.
pub trait GarminIngestion: Send + Sync {
    fn ingest_audit(
        &mut self,
        permit: &GarminWritePermit,
        batch: &FetchResult,
    ) -> Result<IngestReceipt, IngestionError>;

    fn write_facts(
        &mut self,
        permit: &GarminWritePermit,
        batch: &FetchResult,
    ) -> Result<IngestReceipt, IngestionError>;
}

/// Capability object for one verified runner invocation.  It intentionally does
/// not expose a public constructor so connector implementations cannot fabricate
/// authority from a request payload.
pub struct GarminWritePermit {
    account_id: String,
    lease_holder: String,
    fencing_token: String,
}

impl GarminWritePermit {
    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    pub fn lease_holder(&self) -> &str {
        &self.lease_holder
    }

    pub fn fencing_token(&self) -> &str {
        &self.fencing_token
    }

    pub(super) fn verified(
        account_id: &str,
        lease_holder: &str,
        fencing_token: &str,
    ) -> Self {
        Self {
            account_id: account_id.to_string(),
            lease_holder: lease_holder.to_string(),
            fencing_token: fencing_token.to_string(),
        }
    }
}
