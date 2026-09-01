mod dto;
mod guard;
mod ingestion;
mod mock;
mod provider;
mod runner;
mod state;

pub use guard::{GarminWorkerControl, GarminWriterGuard};
pub use dto::*;
pub use ingestion::{GarminIngestion, IngestReceipt, IngestionError};
pub use mock::MockGarminProvider;
pub use provider::{GarminProvider, ProviderError};
pub use runner::GarminRunner;
pub use state::{
    can_fetch, can_ingest, transition, AccountSchedule, CutoverEvent, CutoverPhase,
    FetchPrincipal, IngestMode, TransitionError,
};

#[cfg(test)]
mod state_tests {
    use super::state::*;

    #[test]
    fn happy_path_cutover() {
        let mut phase = CutoverPhase::DesktopCollectorActive;
        phase = transition(phase, CutoverEvent::BeginDrain, 0).unwrap();
        assert_eq!(phase, CutoverPhase::Drain);
        phase = transition(phase, CutoverEvent::DrainComplete, 0).unwrap();
        assert_eq!(phase, CutoverPhase::ServerObserve);
        phase = transition(phase, CutoverEvent::ObservePassed, 0).unwrap();
        assert_eq!(phase, CutoverPhase::ServerActive);
        phase = transition(phase, CutoverEvent::RevokeDesktopCollect, 0).unwrap();
        assert_eq!(phase, CutoverPhase::DesktopPullOnly);
    }

    #[test]
    fn rollback_from_server_active_blocked() {
        let err = transition(CutoverPhase::ServerActive, CutoverEvent::RollbackToDesktop, 0)
            .unwrap_err();
        assert!(matches!(err, TransitionError::ServerWriterActive));
    }

    #[test]
    fn drain_incomplete_blocks_observe() {
        let err = transition(CutoverPhase::Drain, CutoverEvent::DrainComplete, 3).unwrap_err();
        assert!(matches!(err, TransitionError::DrainIncomplete));
    }

    #[test]
    fn rollback_from_observe() {
        let phase = transition(CutoverPhase::ServerObserve, CutoverEvent::RollbackToDesktop, 0)
            .unwrap();
        assert_eq!(phase, CutoverPhase::DesktopCollectorActive);
    }

    #[test]
    fn invalid_skip_observe() {
        let err = transition(CutoverPhase::Drain, CutoverEvent::ActivateServer, 0).unwrap_err();
        assert!(matches!(err, TransitionError::Invalid { .. }));
    }

    #[test]
    fn fetch_principal_gating() {
        assert!(can_fetch(
            CutoverPhase::DesktopCollectorActive,
            FetchPrincipal::Desktop
        ));
        assert!(!can_fetch(
            CutoverPhase::DesktopCollectorActive,
            FetchPrincipal::Server
        ));
        assert!(can_fetch(CutoverPhase::ServerObserve, FetchPrincipal::Server));
        assert!(!can_fetch(
            CutoverPhase::DesktopPullOnly,
            FetchPrincipal::Desktop
        ));
    }

    #[test]
    fn ingest_gating() {
        use super::state::IngestMode;
        assert!(!can_ingest(
            CutoverPhase::DesktopCollectorActive,
            IngestMode::AuditOnly
        ));
        assert!(can_ingest(
            CutoverPhase::ServerObserve,
            IngestMode::AuditOnly
        ));
        assert!(!can_ingest(
            CutoverPhase::ServerObserve,
            IngestMode::WriteFacts
        ));
        assert!(can_ingest(
            CutoverPhase::ServerActive,
            IngestMode::WriteFacts
        ));
    }
}
