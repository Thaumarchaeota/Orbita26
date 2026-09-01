use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::dto::{FetchResult, FetchWindow, ProbeCapabilities};
use super::guard::GarminWriterGuard;
use super::ingestion::{GarminIngestion, GarminWritePermit, IngestReceipt};
use super::provider::{GarminProvider, ProviderError};
use super::state::IngestMode;
use crate::db::Database;

/// Owns the full server-side Garmin write path.  Do not call a provider and an
/// ingestion sink separately: every run rechecks the lease immediately before
/// the sink sees the fetched payload, so a stale worker cannot commit facts.
pub struct GarminRunner<P, S> {
    db: Arc<Database>,
    provider: P,
    sink: S,
    lease_holder: String,
    fencing_token: String,
}

impl<P, S> GarminRunner<P, S>
where
    P: GarminProvider,
    S: GarminIngestion,
{
    pub fn new(
        db: Arc<Database>,
        provider: P,
        sink: S,
        lease_holder: impl Into<String>,
        fencing_token: impl Into<String>,
    ) -> Self {
        Self {
            db,
            provider,
            sink,
            lease_holder: lease_holder.into(),
            fencing_token: fencing_token.into(),
        }
    }

    pub fn run_observe(
        &mut self,
        account_id: &str,
        window: &FetchWindow,
    ) -> Result<IngestReceipt> {
        self.run(account_id, window, IngestMode::AuditOnly)
    }

    pub fn run_active(
        &mut self,
        account_id: &str,
        window: &FetchWindow,
    ) -> Result<IngestReceipt> {
        self.run(account_id, window, IngestMode::WriteFacts)
    }

    pub fn probe(&mut self, account_id: &str) -> Result<ProbeCapabilities> {
        // A probe is an external fetch and therefore obeys the same writer phase
        // and lease rule as an ingestion run; it is never an out-of-band escape.
        self.require_permit(account_id, IngestMode::AuditOnly)?;
        self.provider.connect(account_id).map_err(provider_error)?;
        self.provider.probe_capabilities().map_err(provider_error)
    }

    pub fn into_parts(self) -> (P, S) {
        (self.provider, self.sink)
    }

    fn run(
        &mut self,
        account_id: &str,
        window: &FetchWindow,
        mode: IngestMode,
    ) -> Result<IngestReceipt> {
        self.require_permit(account_id, mode)?;
        self.provider.connect(account_id).map_err(provider_error)?;
        let batch = self.provider.fetch_window(window).map_err(provider_error)?;

        // Provider I/O can take long enough for a lease to expire or be fenced.
        // Mint the capability only after it returns, immediately before ingestion.
        let permit = self.require_permit(account_id, mode)?;
        self.ingest(&permit, &batch, mode).map_err(|error| anyhow!(error))
    }

    fn require_permit(&self, account_id: &str, mode: IngestMode) -> Result<GarminWritePermit> {
        GarminWriterGuard::verified_permit(
            &self.db,
            account_id,
            &self.lease_holder,
            &self.fencing_token,
            mode,
        )
    }

    fn ingest(
        &mut self,
        permit: &GarminWritePermit,
        batch: &FetchResult,
        mode: IngestMode,
    ) -> Result<IngestReceipt, super::ingestion::IngestionError> {
        match mode {
            IngestMode::AuditOnly => self.sink.ingest_audit(permit, batch),
            IngestMode::WriteFacts => self.sink.write_facts(permit, batch),
        }
    }
}

fn provider_error(error: ProviderError) -> anyhow::Error {
    anyhow!(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::secrets::install_test_secrets;
    use crate::connectors::garmin::mock::MockGarminProvider;
    use crate::db::repository::{with_transaction, AccountRepo};
    use crate::db::{test_db, utc_now};

    #[derive(Default)]
    struct RecordingSink {
        audit_runs: u32,
        fact_writes: u32,
    }

    impl GarminIngestion for RecordingSink {
        fn ingest_audit(
            &mut self,
            permit: &GarminWritePermit,
            _batch: &FetchResult,
        ) -> Result<IngestReceipt, super::super::ingestion::IngestionError> {
            assert_eq!(permit.account_id(), "acct");
            self.audit_runs += 1;
            Ok(IngestReceipt { accepted: 0, deduped: 0, rejected: 0 })
        }

        fn write_facts(
            &mut self,
            _permit: &GarminWritePermit,
            _batch: &FetchResult,
        ) -> Result<IngestReceipt, super::super::ingestion::IngestionError> {
            self.fact_writes += 1;
            Ok(IngestReceipt { accepted: 0, deduped: 0, rejected: 0 })
        }
    }

    fn seed(db: &Arc<Database>, phase: &str) {
        with_transaction(db, |tx| {
            AccountRepo::ensure_account(tx, "acct")?;
            let expiry = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
            tx.execute(
                "INSERT INTO connector_writer_states(
                    account_id, connector, phase, phase_version, lease_holder,
                    lease_expires_at_utc, fencing_token, state_json, updated_at_utc
                ) VALUES ('acct','garmin',?1,1,'srv',?2,'fence','{}',?3)",
                rusqlite::params![phase, expiry, utc_now()],
            )?;
            Ok(())
        })
        .unwrap();
    }

    fn window() -> FetchWindow {
        FetchWindow {
            start: chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            end: chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        }
    }

    #[test]
    fn observe_runner_cannot_write_facts() {
        install_test_secrets();
        let db = test_db();
        seed(&db, "ServerObserve");
        let mut runner = GarminRunner::new(db, MockGarminProvider::new(), RecordingSink::default(), "srv", "fence");

        runner.run_observe("acct", &window()).unwrap();
        let (_, sink) = runner.into_parts();
        assert_eq!(sink.audit_runs, 1);
        assert_eq!(sink.fact_writes, 0);
    }

    #[test]
    fn active_runner_rejects_observe_phase() {
        install_test_secrets();
        let db = test_db();
        seed(&db, "ServerObserve");
        let mut runner = GarminRunner::new(db, MockGarminProvider::new(), RecordingSink::default(), "srv", "fence");

        assert!(runner.run_active("acct", &window()).is_err());
    }
}
