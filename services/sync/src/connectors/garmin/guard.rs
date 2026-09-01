use anyhow::{anyhow, Result};
use std::sync::Arc;

use crate::connectors::garmin::ingestion::GarminWritePermit;
use crate::connectors::garmin::state::{
    can_fetch, can_ingest, transition, CutoverEvent, CutoverPhase, FetchPrincipal, IngestMode,
};
use crate::connectors::writer_transition::{WriterTransitionRow, WriterTransitionStore};
use crate::db::Database;

pub struct GarminWriterGuard;

/// Lifecycle ownership is deliberately separate from state persistence.  A
/// rollback is safe only after the concrete worker has stopped and joined; a
/// phase flip alone cannot fence an already-running provider call.
pub trait GarminWorkerControl {
    fn stop_and_join(&mut self, account_id: &str) -> Result<()>;
}

impl GarminWriterGuard {
    pub fn verify_fetch(
        db: &Arc<Database>,
        account_id: &str,
        holder: &str,
        fencing_token: &str,
    ) -> Result<WriterTransitionRow> {
        let row = WriterTransitionStore::load(db, account_id, "garmin")?
            .ok_or_else(|| anyhow!("garmin writer state missing"))?;
        WriterTransitionStore::verify_lease(&row, holder, fencing_token)?;
        let phase = parse_phase(&row.phase)?;
        if !can_fetch(phase, FetchPrincipal::Server) {
            return Err(anyhow!("server fetch not allowed for current garmin phase"));
        }
        Ok(row)
    }

    pub fn verify_ingest(row: &WriterTransitionRow, mode: IngestMode) -> Result<()> {
        let phase = parse_phase(&row.phase)?;
        if !can_ingest(phase, mode) {
            return Err(anyhow!("ingest not allowed for phase/mode"));
        }
        Ok(())
    }

    pub fn verified_permit(
        db: &Arc<Database>,
        account_id: &str,
        holder: &str,
        fencing_token: &str,
        mode: IngestMode,
    ) -> Result<GarminWritePermit> {
        let row = Self::verify_fetch(db, account_id, holder, fencing_token)?;
        Self::verify_ingest(&row, mode)?;
        Ok(GarminWritePermit::verified(account_id, holder, fencing_token))
    }

    pub fn rollback<W: GarminWorkerControl>(
        db: &Arc<Database>,
        worker: &mut W,
        row: &WriterTransitionRow,
        drain_watermark: &str,
    ) -> Result<WriterTransitionRow> {
        let phase = parse_phase(&row.phase)?;
        transition(phase, CutoverEvent::RollbackToDesktop, 0)
            .map_err(|error| anyhow!(error))?;
        worker.stop_and_join(&row.account_id)?;
        WriterTransitionStore::cas_transition(
            db,
            row,
            row.phase_version,
            "DesktopCollectorActive",
            None,
            None,
            None,
            row.audit_watermark.as_deref(),
            Some(drain_watermark),
        )
    }
}

fn parse_phase(raw: &str) -> Result<CutoverPhase> {
    match raw {
        "DesktopCollectorActive" => Ok(CutoverPhase::DesktopCollectorActive),
        "Drain" => Ok(CutoverPhase::Drain),
        "ServerObserve" => Ok(CutoverPhase::ServerObserve),
        "ServerActive" => Ok(CutoverPhase::ServerActive),
        "DesktopPullOnly" => Ok(CutoverPhase::DesktopPullOnly),
        other => Err(anyhow!("unknown phase: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::secrets::install_test_secrets;
    use crate::connectors::writer_transition::WriterTransitionStore;
    use crate::db::repository::{AccountRepo, with_transaction};
    use crate::db::test_db;
    use crate::db::utc_now;

    struct StoppedWorker {
        stopped_account: Option<String>,
    }

    impl GarminWorkerControl for StoppedWorker {
        fn stop_and_join(&mut self, account_id: &str) -> Result<()> {
            self.stopped_account = Some(account_id.to_string());
            Ok(())
        }
    }

    #[test]
    fn observe_allows_audit_only() {
        install_test_secrets();
        let db = test_db();
        let account = "acct";
        with_transaction(&db, |tx| {
            AccountRepo::ensure_account(tx, account)?;
            tx.execute(
                "INSERT INTO connector_writer_states(
                    account_id, connector, phase, phase_version, lease_holder,
                    lease_expires_at_utc, fencing_token, state_json, updated_at_utc
                ) VALUES (?1,'garmin','ServerObserve',1,'srv',?2,'fence','{}',?2)",
                rusqlite::params![account, utc_now()],
            )?;
            Ok(())
        })
        .unwrap();
        let row = WriterTransitionStore::load(&db, account, "garmin").unwrap().unwrap();
        assert!(GarminWriterGuard::verify_ingest(&row, IngestMode::AuditOnly).is_ok());
        assert!(GarminWriterGuard::verify_ingest(&row, IngestMode::WriteFacts).is_err());
    }

    #[test]
    fn rollback_stops_worker_before_releasing_lease() {
        install_test_secrets();
        let db = test_db();
        let account = "acct";
        let future = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
        with_transaction(&db, |tx| {
            AccountRepo::ensure_account(tx, account)?;
            tx.execute(
                "INSERT INTO connector_writer_states(
                    account_id, connector, phase, phase_version, lease_holder,
                    lease_expires_at_utc, fencing_token, state_json, updated_at_utc
                ) VALUES (?1,'garmin','ServerObserve',1,'srv',?2,'fence','{}',?3)",
                rusqlite::params![account, future, utc_now()],
            )?;
            Ok(())
        })
        .unwrap();
        let row = WriterTransitionStore::load(&db, account, "garmin").unwrap().unwrap();
        let mut worker = StoppedWorker { stopped_account: None };

        let out = GarminWriterGuard::rollback(&db, &mut worker, &row, "drained").unwrap();

        assert_eq!(worker.stopped_account.as_deref(), Some(account));
        assert_eq!(out.phase, "DesktopCollectorActive");
        assert!(out.lease_holder.is_none());
        assert!(out.fencing_token.is_some());
    }
}
