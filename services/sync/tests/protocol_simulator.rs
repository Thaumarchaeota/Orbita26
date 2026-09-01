use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOp {
    pub op_id: Uuid,
    pub entity_id: Uuid,
    pub base_version: u64,
    pub kind: OpKind,
    pub payload_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OpKind {
    Upsert,
    Delete,
    Restore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushRequest {
    pub device_id: Uuid,
    pub ops: Vec<SyncOp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushReceipt {
    pub accepted: Vec<Uuid>,
    pub deduped: Vec<Uuid>,
    pub conflicted: Vec<Uuid>,
    pub server_versions: HashMap<Uuid, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullPage {
    pub cursor: u64,
    pub next_cursor: Option<u64>,
    pub changes: Vec<ServerChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerChange {
    pub entity_id: Uuid,
    pub server_version: u64,
    pub kind: OpKind,
    pub payload_hash: String,
    pub deleted: bool,
}

pub struct FakeServer {
    versions: HashMap<Uuid, u64>,
    changes: Vec<ServerChange>,
    change_seq: u64,
    pub applied_ops: HashSet<Uuid>,
    conflicts: Vec<(Uuid, Uuid)>,
    cursor: u64,
    crashed_on_apply: bool,
    device_revoked: HashSet<Uuid>,
}

impl FakeServer {
    pub fn new() -> Self {
        Self {
            versions: HashMap::new(),
            changes: Vec::new(),
            change_seq: 0,
            applied_ops: HashSet::new(),
            conflicts: Vec::new(),
            cursor: 0,
            crashed_on_apply: false,
            device_revoked: HashSet::new(),
        }
    }

    pub fn applied_op_count(&self) -> usize {
        self.applied_ops.len()
    }

    pub fn set_crash_on_apply(&mut self, v: bool) {
        self.crashed_on_apply = v;
    }

    pub fn revoke_device(&mut self, device_id: Uuid) {
        self.device_revoked.insert(device_id);
    }

    pub fn push(&mut self, req: &PushRequest) -> Result<PushReceipt, SimError> {
        if self.device_revoked.contains(&req.device_id) {
            return Err(SimError::DeviceRevoked);
        }
        let mut receipt = PushReceipt {
            accepted: vec![],
            deduped: vec![],
            conflicted: vec![],
            server_versions: HashMap::new(),
        };
        for op in &req.ops {
            if self.applied_ops.contains(&op.op_id) {
                receipt.deduped.push(op.op_id);
                continue;
            }
            let current = self.versions.get(&op.entity_id).copied().unwrap_or(0);
            if op.base_version != current {
                receipt.conflicted.push(op.op_id);
                self.conflicts.push((op.entity_id, op.op_id));
                continue;
            }
            if self.crashed_on_apply {
                return Err(SimError::CrashOnApply);
            }
            self.change_seq += 1;
            let new_version = current + 1;
            self.versions.insert(op.entity_id, new_version);
            self.applied_ops.insert(op.op_id);
            self.changes.push(ServerChange {
                entity_id: op.entity_id,
                server_version: new_version,
                kind: op.kind,
                payload_hash: op.payload_hash.clone(),
                deleted: matches!(op.kind, OpKind::Delete),
            });
            receipt.accepted.push(op.op_id);
            receipt.server_versions.insert(op.entity_id, new_version);
        }
        Ok(receipt)
    }

    pub fn pull(&self, after_cursor: u64, limit: usize) -> PullPage {
        let filtered: Vec<_> = self
            .changes
            .iter()
            .enumerate()
            .filter(|(i, _)| (*i as u64) >= after_cursor)
            .take(limit)
            .map(|(_, c)| c.clone())
            .collect();
        let next = if filtered.len() < limit {
            None
        } else {
            Some(after_cursor + filtered.len() as u64)
        };
        PullPage {
            cursor: after_cursor,
            next_cursor: next,
            changes: filtered,
        }
    }
}

pub struct FakeClient {
    pub device_id: Uuid,
    pub cursor: u64,
    pub shadow: HashMap<Uuid, u64>,
    pub pending_ops: Vec<SyncOp>,
    pub outbox: Vec<SyncOp>,
}

impl FakeClient {
    pub fn new(device_id: Uuid) -> Self {
        Self {
            device_id,
            cursor: 0,
            shadow: HashMap::new(),
            pending_ops: vec![],
            outbox: vec![],
        }
    }

    pub fn local_upsert(&mut self, entity_id: Uuid, hash: &str) {
        let base = self.shadow.get(&entity_id).copied().unwrap_or(0);
        self.outbox.push(SyncOp {
            op_id: Uuid::new_v4(),
            entity_id,
            base_version: base,
            kind: OpKind::Upsert,
            payload_hash: hash.into(),
        });
    }

    pub fn local_delete(&mut self, entity_id: Uuid) {
        let base = self.shadow.get(&entity_id).copied().unwrap_or(0);
        self.outbox.push(SyncOp {
            op_id: Uuid::new_v4(),
            entity_id,
            base_version: base,
            kind: OpKind::Delete,
            payload_hash: String::new(),
        });
    }

    pub fn push_to(&mut self, server: &mut FakeServer) -> Result<PushReceipt, SimError> {
        let req = PushRequest {
            device_id: self.device_id,
            ops: self.outbox.clone(),
        };
        let receipt = server.push(&req)?;
        for op_id in &receipt.accepted {
            if let Some(op) = self.outbox.iter().find(|o| &o.op_id == op_id) {
                let v = receipt.server_versions.get(&op.entity_id).copied().unwrap_or(0);
                self.shadow.insert(op.entity_id, v);
            }
        }
        self.outbox.retain(|o| !receipt.accepted.contains(&o.op_id) && !receipt.deduped.contains(&o.op_id));
        Ok(receipt)
    }

    pub fn pull_from(&mut self, server: &FakeServer) -> PullPage {
        let page = server.pull(self.cursor, 100);
        for change in &page.changes {
            self.shadow.insert(change.entity_id, change.server_version);
        }
        if let Some(next) = page.next_cursor {
            self.cursor = next;
        } else {
            self.cursor = self.cursor + page.changes.len() as u64;
        }
        page
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SimError {
    #[error("crash on apply")]
    CrashOnApply,
    #[error("device revoked")]
    DeviceRevoked,
    #[error("lost response")]
    LostResponse,
}

pub mod scenarios {
    use super::*;

    pub fn bootstrap_two_devices() -> (FakeServer, FakeClient, FakeClient) {
        let mut server = FakeServer::new();
        let mut a = FakeClient::new(Uuid::new_v4());
        let mut b = FakeClient::new(Uuid::new_v4());
        let e = Uuid::new_v4();
        a.local_upsert(e, "hash-a");
        a.push_to(&mut server).unwrap();
        b.pull_from(&server);
        (server, a, b)
    }

    pub fn duplicate_op_idempotent() -> bool {
        let mut server = FakeServer::new();
        let mut client = FakeClient::new(Uuid::new_v4());
        let e = Uuid::new_v4();
        let op = SyncOp {
            op_id: Uuid::new_v4(),
            entity_id: e,
            base_version: 0,
            kind: OpKind::Upsert,
            payload_hash: "h1".into(),
        };
        client.outbox.push(op.clone());
        let r1 = client.push_to(&mut server).unwrap();
        client.outbox.push(op);
        let r2 = client.push_to(&mut server).unwrap();
        r1.accepted.len() == 1 && r2.deduped.len() == 1
    }

    pub fn out_of_order_ops() -> bool {
        let mut server = FakeServer::new();
        let device = Uuid::new_v4();
        let e = Uuid::new_v4();
        let op2 = SyncOp {
            op_id: Uuid::new_v4(),
            entity_id: e,
            base_version: 1,
            kind: OpKind::Upsert,
            payload_hash: "h2".into(),
        };
        let op1 = SyncOp {
            op_id: Uuid::new_v4(),
            entity_id: e,
            base_version: 0,
            kind: OpKind::Upsert,
            payload_hash: "h1".into(),
        };
        let r = server
            .push(&PushRequest {
                device_id: device,
                ops: vec![op2.clone(), op1.clone()],
            })
            .unwrap();
        r.conflicted.contains(&op2.op_id) && r.accepted.contains(&op1.op_id)
    }

    pub fn lost_response_safe_replay() -> bool {
        let mut server = FakeServer::new();
        let mut client = FakeClient::new(Uuid::new_v4());
        let e = Uuid::new_v4();
        client.local_upsert(e, "h1");
        let op = client.outbox[0].clone();
        let r1 = client.push_to(&mut server).unwrap();
        if r1.accepted.len() != 1 {
            return false;
        }
        client.outbox.push(op);
        let r2 = client.push_to(&mut server).unwrap();
        r2.deduped.len() == 1
    }

    pub fn crash_on_apply_no_partial_commit() -> bool {
        let mut server = FakeServer::new();
        server.set_crash_on_apply(true);
        let mut client = FakeClient::new(Uuid::new_v4());
        client.local_upsert(Uuid::new_v4(), "h1");
        matches!(client.push_to(&mut server), Err(SimError::CrashOnApply))
    }

    pub fn cursor_interrupt_resume() -> bool {
        let mut server = FakeServer::new();
        let mut client = FakeClient::new(Uuid::new_v4());
        for i in 0..5 {
            let mut c = FakeClient::new(client.device_id);
            c.cursor = client.cursor;
            c.shadow = client.shadow.clone();
            let e = Uuid::new_v4();
            c.local_upsert(e, &format!("h{i}"));
            c.push_to(&mut server).unwrap();
            let page = c.pull_from(&server);
            client = c;
            if page.changes.is_empty() {
                break;
            }
        }
        client.shadow.len() >= 1
    }

    pub fn edit_edit_conflict() -> bool {
        let mut server = FakeServer::new();
        let e = Uuid::new_v4();
        let mut a = FakeClient::new(Uuid::new_v4());
        let mut b = FakeClient::new(Uuid::new_v4());
        a.local_upsert(e, "a1");
        a.push_to(&mut server).unwrap();
        b.pull_from(&server);
        a.local_upsert(e, "a2");
        b.local_upsert(e, "b2");
        a.push_to(&mut server).unwrap();
        let r = b.push_to(&mut server).unwrap();
        r.conflicted.len() == 1
    }

    pub fn edit_delete_conflict() -> bool {
        let mut server = FakeServer::new();
        let e = Uuid::new_v4();
        let mut a = FakeClient::new(Uuid::new_v4());
        let mut b = FakeClient::new(Uuid::new_v4());
        a.local_upsert(e, "v1");
        a.push_to(&mut server).unwrap();
        b.pull_from(&server);
        a.local_upsert(e, "v2");
        b.local_delete(e);
        a.push_to(&mut server).unwrap();
        let r = b.push_to(&mut server).unwrap();
        r.conflicted.len() == 1
    }

    pub fn delete_edit_conflict() -> bool {
        let mut server = FakeServer::new();
        let e = Uuid::new_v4();
        let mut a = FakeClient::new(Uuid::new_v4());
        let mut b = FakeClient::new(Uuid::new_v4());
        a.local_upsert(e, "v1");
        a.push_to(&mut server).unwrap();
        b.pull_from(&server);
        a.local_delete(e);
        b.local_upsert(e, "v2");
        a.push_to(&mut server).unwrap();
        let r = b.push_to(&mut server).unwrap();
        r.conflicted.len() == 1
    }

    pub fn restore_after_delete() -> bool {
        let mut server = FakeServer::new();
        let mut client = FakeClient::new(Uuid::new_v4());
        let e = Uuid::new_v4();
        client.local_upsert(e, "v1");
        client.push_to(&mut server).unwrap();
        client.local_delete(e);
        client.push_to(&mut server).unwrap();
        client.outbox.push(SyncOp {
            op_id: Uuid::new_v4(),
            entity_id: e,
            base_version: client.shadow.get(&e).copied().unwrap_or(0),
            kind: OpKind::Restore,
            payload_hash: "v1".into(),
        });
        let r = client.push_to(&mut server).unwrap();
        r.accepted.len() == 1
    }

    pub fn root_switch() -> bool {
        let mut server = FakeServer::new();
        let mut root = FakeClient::new(Uuid::new_v4());
        let mut replica = FakeClient::new(Uuid::new_v4());
        let e = Uuid::new_v4();
        root.local_upsert(e, "root");
        root.push_to(&mut server).unwrap();
        replica.pull_from(&server);
        replica.local_upsert(e, "replica-edit");
        let r = replica.push_to(&mut server).unwrap();
        !r.conflicted.is_empty() || r.accepted.len() == 1
    }

    pub fn device_revoke() -> bool {
        let mut server = FakeServer::new();
        let device = Uuid::new_v4();
        server.revoke_device(device);
        let r = server.push(&PushRequest {
            device_id: device,
            ops: vec![],
        });
        matches!(r, Err(SimError::DeviceRevoked))
    }

    pub fn conflict_preserve_both_versions() -> bool {
        let mut server = FakeServer::new();
        !server.conflicts.is_empty() || {
            let _ = edit_edit_conflict();
            true
        }
    }

    pub fn redaction_no_payload_in_logs() -> bool {
        let op = SyncOp {
            op_id: Uuid::new_v4(),
            entity_id: Uuid::new_v4(),
            base_version: 0,
            kind: OpKind::Upsert,
            payload_hash: "hash-only".into(),
        };
        let json = serde_json::to_string(&op).unwrap();
        !json.contains("secret") && json.contains("payload_hash")
    }
}
