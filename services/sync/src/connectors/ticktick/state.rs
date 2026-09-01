use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerWriterState {
    pub account_id: String,
    pub phase: BrokerPhase,
    pub principal: Option<String>,
    pub lease_holder: Option<String>,
    pub audit_watermark: Option<String>,
    pub pending_commands: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BrokerPhase {
    DesktopDirect,
    ServerOauthMirror,
    DesktopWriteFreeze,
    ServerBrokerActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrokerEvent {
    BeginOauthMirror,
    OauthMirrorComplete,
    FreezeDesktopWrites,
    ActivateServerBroker,
    RollbackToDesktop,
}

#[derive(Debug, thiserror::Error)]
pub enum BrokerTransitionError {
    #[error("invalid transition from {from:?} via {event:?}")]
    Invalid { from: BrokerPhase, event: BrokerEvent },
    #[error("pending commands must drain before freeze")]
    PendingCommandsRemain,
    #[error("rollback blocked: server broker still active")]
    ServerBrokerActive,
}

pub fn transition(
    phase: BrokerPhase,
    event: BrokerEvent,
    pending_commands: u64,
) -> Result<BrokerPhase, BrokerTransitionError> {
    use BrokerEvent::*;
    use BrokerPhase::*;

    match (phase, event) {
        (DesktopDirect, BeginOauthMirror) => Ok(ServerOauthMirror),
        (ServerOauthMirror, OauthMirrorComplete) if pending_commands == 0 => Ok(DesktopWriteFreeze),
        (ServerOauthMirror, OauthMirrorComplete) => Err(BrokerTransitionError::PendingCommandsRemain),
        (DesktopWriteFreeze, ActivateServerBroker) => Ok(ServerBrokerActive),
        (ServerBrokerActive, RollbackToDesktop) => Err(BrokerTransitionError::ServerBrokerActive),
        (ServerOauthMirror, RollbackToDesktop) => Ok(DesktopDirect),
        (DesktopWriteFreeze, RollbackToDesktop) => Ok(DesktopDirect),
        (from, event) => Err(BrokerTransitionError::Invalid { from, event }),
    }
}

pub fn can_call_ticktick_api(phase: BrokerPhase, caller: ApiCaller) -> bool {
    match (phase, caller) {
        (BrokerPhase::DesktopDirect, ApiCaller::Desktop) => true,
        (BrokerPhase::ServerOauthMirror, ApiCaller::Server) => true,
        (BrokerPhase::DesktopWriteFreeze, ApiCaller::Server) => true,
        (BrokerPhase::ServerBrokerActive, ApiCaller::Server) => true,
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TickTickWriteMode {
    ReadMirror,
    ExecuteCommand,
}

pub fn allowed_write_mode(phase: BrokerPhase) -> Option<TickTickWriteMode> {
    match phase {
        BrokerPhase::ServerOauthMirror | BrokerPhase::DesktopWriteFreeze => {
            Some(TickTickWriteMode::ReadMirror)
        }
        BrokerPhase::ServerBrokerActive => Some(TickTickWriteMode::ExecuteCommand),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiCaller {
    Desktop,
    Server,
}
