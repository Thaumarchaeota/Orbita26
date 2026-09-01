use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CutoverPhase {
    DesktopCollectorActive,
    Drain,
    ServerObserve,
    ServerActive,
    DesktopPullOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSchedule {
    pub account_id: String,
    pub lease_holder: Option<String>,
    pub lease_expires_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub cooldown_until: Option<DateTime<Utc>>,
    pub last_success_window_end: Option<NaiveDate>,
    pub phase: CutoverPhase,
}

#[derive(Debug, thiserror::Error)]
pub enum TransitionError {
    #[error("invalid transition from {from:?} via {event:?}")]
    Invalid { from: CutoverPhase, event: CutoverEvent },
    #[error("drain incomplete: pending outbox items remain")]
    DrainIncomplete,
    #[error("observe reconciliation failed")]
    ObserveFailed,
    #[error("rollback blocked: server writer still active")]
    ServerWriterActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CutoverEvent {
    BeginDrain,
    DrainComplete,
    BeginObserve,
    ObservePassed,
    ActivateServer,
    RevokeDesktopCollect,
    RollbackToDesktop,
}

pub fn transition(
    phase: CutoverPhase,
    event: CutoverEvent,
    pending_garmin_outbox: u64,
) -> Result<CutoverPhase, TransitionError> {
    use CutoverEvent::*;
    use CutoverPhase::*;

    match (phase, event) {
        (DesktopCollectorActive, BeginDrain) => Ok(Drain),
        (Drain, DrainComplete) if pending_garmin_outbox == 0 => Ok(ServerObserve),
        (Drain, DrainComplete) => Err(TransitionError::DrainIncomplete),
        (ServerObserve, ObservePassed) => Ok(ServerActive),
        (ServerActive, RevokeDesktopCollect) => Ok(DesktopPullOnly),
        (ServerActive, RollbackToDesktop) => Err(TransitionError::ServerWriterActive),
        (ServerObserve, RollbackToDesktop) => Ok(DesktopCollectorActive),
        (Drain, RollbackToDesktop) => Ok(DesktopCollectorActive),
        (DesktopPullOnly, RollbackToDesktop) => Ok(DesktopCollectorActive),
        (from, event) => Err(TransitionError::Invalid { from, event }),
    }
}

pub fn can_fetch(phase: CutoverPhase, principal: FetchPrincipal) -> bool {
    match (phase, principal) {
        (CutoverPhase::DesktopCollectorActive, FetchPrincipal::Desktop) => true,
        (CutoverPhase::Drain, FetchPrincipal::Desktop) => false,
        (CutoverPhase::ServerObserve, FetchPrincipal::Server) => true,
        (CutoverPhase::ServerActive, FetchPrincipal::Server) => true,
        (CutoverPhase::DesktopPullOnly, _) => false,
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchPrincipal {
    Desktop,
    Server,
}

pub fn can_ingest(phase: CutoverPhase, mode: IngestMode) -> bool {
    match (phase, mode) {
        (CutoverPhase::ServerObserve, IngestMode::AuditOnly) => true,
        (CutoverPhase::ServerActive, IngestMode::WriteFacts) => true,
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestMode {
    AuditOnly,
    WriteFacts,
}
