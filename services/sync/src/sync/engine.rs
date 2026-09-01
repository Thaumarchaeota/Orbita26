use std::sync::Arc;

use anyhow::{anyhow, Result};
use serde_json::Value;

use crate::auth::capabilities;
use crate::auth::AuthContext;
use crate::canonical::{snapshot_content_hash, tombstone_content_hash};
use crate::db::repository::{
    with_transaction, AccountRepo, ConflictRepo, CurrentRecord, NaturalKeyRepo, OperationRepo,
    OpReceipt, PullRepo, RecordRepo, VersionRow,
};
use crate::db::Database;
use crate::diagnostics::timeline::{
    TimelineRepo, EVENT_ACK, EVENT_CONFLICT, EVENT_PULL, EVENT_PUSH, EVENT_RESOLVE,
};
use crate::metrics::Metrics;
use crate::sync::errors::SyncErrorCode;
use crate::sync::limits::{
    CONTRACT_VERSION, DOMAIN_FINANCE, MAX_BATCH_OPS, MAX_PULL_LIMIT,
};
use crate::sync::natural_key::{fact_source, validate_and_hash};
use crate::sync::schema_validate::{
    validate_ack_request, validate_ack_response, validate_pull_request, validate_pull_response,
    validate_push_request, validate_push_response,
};
use crate::sync::types::*;
use crate::sync::validate::validate_operation;
use serde_json::json;
use uuid::Uuid;

pub fn validate_contract(contract_version: &str) -> Result<()> {
    if contract_version != CONTRACT_VERSION {
        return Err(anyhow!("unsupported contract_version"));
    }
    Ok(())
}

pub fn validate_device(auth: &AuthContext, device_id: &str) -> Result<()> {
    if device_id != auth.device_id {
        return Err(anyhow!("device_id scope mismatch"));
    }
    Ok(())
}

pub fn apply_push_ops(
    db: &Arc<Database>,
    auth: &AuthContext,
    req: PushRequest,
    metrics: &Metrics,
    correlation_id: Option<String>,
) -> Result<PushResponse> {
    validate_contract(&req.contract_version)?;
    validate_device(auth, &req.device_id)?;
    validate_push_request(&req)?;
    if req.changes.len() > MAX_BATCH_OPS {
        return Err(anyhow!("batch exceeds limit"));
    }

    let correlation_id = correlation_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let results = with_transaction(db, |tx| {
        AccountRepo::ensure_account(tx, &auth.account_id)?;
        let mut out = Vec::with_capacity(req.changes.len());

        for op in req.changes {
            if let Err(e) = validate_operation(&op) {
                let result = reject_result(
                    &op.op_id,
                    SyncErrorCode::ValidationFailed,
                    &e.to_string(),
                );
                log_timeline_event(tx, auth, &op, &correlation_id, &result)?;
                out.push(result);
                metrics.inc_error();
                continue;
            }

            if op.domain == DOMAIN_FINANCE {
                let result = reject_result(
                    &op.op_id,
                    SyncErrorCode::FinanceRejected,
                    "finance domain not supported in v1",
                );
                log_timeline_event(tx, auth, &op, &correlation_id, &result)?;
                out.push(result);
                metrics.inc_error();
                continue;
            }

            let fingerprint = operation_fingerprint(&op);
            if let Some(stored) = OperationRepo::find_receipt(tx, &auth.account_id, &op.op_id)? {
                if stored.request_fingerprint != fingerprint {
                    let result = reject_result(
                        &op.op_id,
                        SyncErrorCode::OpIdReuse,
                        "op_id reused with different request fingerprint",
                    );
                    log_timeline_event(tx, auth, &op, &correlation_id, &result)?;
                    out.push(result);
                    metrics.inc_error();
                    continue;
                }
                metrics.inc_dedupe();
                let result = receipt_to_result(&op.op_id, &stored.receipt, true);
                log_timeline_event(tx, auth, &op, &correlation_id, &result)?;
                out.push(result);
                continue;
            }

            // `origin` is client-controlled diagnostic metadata. Authorization is
            // derived from the fact, so a client cannot relabel Garmin as manual.
            if !capabilities::can_write_garmin(auth, fact_source(&op)) {
                let result = reject_result(
                    &op.op_id,
                    SyncErrorCode::UnauthorizedGarmin,
                    "garmin write not permitted for this device",
                );
                log_timeline_event(tx, auth, &op, &correlation_id, &result)?;
                out.push(result);
                metrics.inc_error();
                continue;
            }

            let result = match apply_single_op(tx, auth, &op, &fingerprint, &correlation_id) {
                Ok(r) => r,
                Err(e) => {
                    if e.to_string() == "NATURAL_KEY_COLLISION" {
                        reject_result(
                            &op.op_id,
                            SyncErrorCode::NaturalKeyCollision,
                            "natural key collision",
                        )
                    } else {
                        return Err(e);
                    }
                }
            };
            log_timeline_event(tx, auth, &op, &correlation_id, &result)?;
            match result.status {
                OpStatus::Conflict => metrics.inc_conflict(),
                OpStatus::Deduplicated => metrics.inc_dedupe(),
                OpStatus::Accepted => metrics.inc_push(),
                _ => {}
            }
            out.push(result);
        }

        let head_seq: i64 = tx.query_row(
            "SELECT COALESCE(MAX(change_seq), 0) FROM record_versions WHERE account_id = ?1",
            rusqlite::params![auth.account_id],
            |row| row.get(0),
        )?;
        Ok((out, head_seq))
    })?;

    let response = PushResponse {
        contract_version: CONTRACT_VERSION.to_string(),
        outcomes: results.0,
        next_change_seq: results.1,
        has_more: false,
    };
    validate_push_response(&response)?;
    Ok(response)
}

fn apply_single_op(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    fingerprint: &str,
    correlation_id: &str,
) -> Result<ChangeOutcome> {
    if op.kind == "resolve" {
        return apply_resolve_op(tx, auth, op, fingerprint, correlation_id);
    }
    let (content_hash, snapshot_json, tombstone_json, natural_key_json, is_tombstone) =
        prepare_wire_payload(op)?;

    let nk_hash = if op.kind == "delete" {
        let nk = op.natural_key.as_ref().unwrap();
        crate::sync::natural_key::validate_natural_key_for_delete(&op.record_type, nk)?;
        crate::canonical::content_hash(nk)
    } else {
        let snap = op.snapshot.as_ref().unwrap();
        validate_and_hash(
            &op.record_type,
            op.natural_key.as_ref().unwrap(),
            snap,
        )?
    };

    let current = RecordRepo::get_current(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
    )?;
    if let Some(cur) = &current {
        if let Err(error) = enforce_existing_source(auth, op, cur) {
            return reject_op(tx, auth, op, fingerprint, correlation_id, &error.to_string());
        }
    }

    match (&current, op.base_server_version, op.kind.as_str()) {
        (None, None | Some(0), _) => accept_new(
            tx,
            auth,
            op,
            fingerprint,
            correlation_id,
            &content_hash,
            &snapshot_json,
            tombstone_json.as_deref(),
            &natural_key_json,
            is_tombstone,
            &nk_hash,
        ),
        (None, Some(_), _) => reject_op(tx, auth, op, fingerprint, correlation_id, "base_server_version mismatch for new record"),
        (Some(cur), _, "delete") => {
            let stored_natural_key: Value = serde_json::from_str(&cur.natural_key_json)
                .map_err(|_| anyhow!("stored natural key is invalid"))?;
            if crate::canonical::canonical_json(&stored_natural_key) != natural_key_json {
                return Ok(reject_result(
                    &op.op_id,
                    SyncErrorCode::ValidationFailed,
                    "delete naturalKey must match current record",
                ));
            }
            if op.base_server_version == Some(cur.server_version) || content_hash == cur.content_hash
            {
                accept_update(
                    tx,
                    auth,
                    op,
                    cur.clone(),
                    fingerprint,
                    correlation_id,
                    &content_hash,
                    &snapshot_json,
                    tombstone_json.as_deref(),
                    &natural_key_json,
                    true,
                    &nk_hash,
                )
            } else if content_hash == cur.content_hash {
                dedupe_op(tx, auth, op, fingerprint, correlation_id, cur.clone())
            } else {
                conflict_op(
                    tx,
                    auth,
                    op,
                    cur.clone(),
                    fingerprint,
                    correlation_id,
                    &content_hash,
                    &snapshot_json,
                )
            }
        }
        (Some(cur), None, _) => {
            if content_hash == cur.content_hash {
                dedupe_op(tx, auth, op, fingerprint, correlation_id, cur.clone())
            } else {
                conflict_op(
                    tx,
                    auth,
                    op,
                    cur.clone(),
                    fingerprint,
                    correlation_id,
                    &content_hash,
                    &snapshot_json,
                )
            }
        }
        (Some(cur), Some(base), _) => {
            if base == cur.server_version {
                accept_update(
                    tx,
                    auth,
                    op,
                    cur.clone(),
                    fingerprint,
                    correlation_id,
                    &content_hash,
                    &snapshot_json,
                    tombstone_json.as_deref(),
                    &natural_key_json,
                    is_tombstone,
                    &nk_hash,
                )
            } else if content_hash == cur.content_hash {
                dedupe_op(tx, auth, op, fingerprint, correlation_id, cur.clone())
            } else {
                conflict_op(
                    tx,
                    auth,
                    op,
                    cur.clone(),
                    fingerprint,
                    correlation_id,
                    &content_hash,
                    &snapshot_json,
                )
            }
        }
    }
}

fn apply_resolve_op(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    fingerprint: &str,
    correlation_id: &str,
) -> Result<ChangeOutcome> {
    let conflict_id = op.conflict_id.as_deref().unwrap_or_default();
    let conflict = match ConflictRepo::get_open(tx, &auth.account_id, conflict_id)? {
        Some(c) => c,
        None => {
            return Ok(reject_result(
                &op.op_id,
                SyncErrorCode::ConflictNotFound,
                "conflict not found",
            ));
        }
    };
    if conflict.status != "open" {
        return Ok(reject_result(
            &op.op_id,
            SyncErrorCode::ConflictClosed,
            "conflict already closed",
        ));
    }
    if conflict.domain != op.domain
        || conflict.record_type != op.record_type
        || conflict.record_id != op.record_id
    {
        return Ok(reject_result(
            &op.op_id,
            SyncErrorCode::ConflictMismatch,
            "conflict entity mismatch",
        ));
    }
    if op.base_server_version != Some(conflict.server_version) {
        return Ok(reject_result(
            &op.op_id,
            SyncErrorCode::VersionConflict,
            "baseServerVersion must match conflict server version",
        ));
    }

    let (content_hash, snapshot_json, tombstone_json, natural_key_json, is_tombstone) =
        prepare_wire_payload(op)?;

    let nk = op.natural_key.as_ref().unwrap();
    validate_and_hash(&op.record_type, nk, op.snapshot.as_ref().unwrap())?;
    let nk_hash = crate::canonical::content_hash(nk);
    if let Some(existing_id) =
        NaturalKeyRepo::lookup_record_id(tx, &auth.account_id, &op.record_type, &nk_hash)?
    {
        if existing_id != op.record_id {
            return Ok(reject_result(
                &op.op_id,
                SyncErrorCode::NaturalKeyCollision,
                "natural key mismatch for resolve",
            ));
        }
    }

    let current = RecordRepo::get_current(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
    )?;
    let cur = current.ok_or_else(|| anyhow!("resolve requires existing record"))?;
    if let Err(error) = enforce_existing_source(auth, op, &cur) {
        return Ok(reject_result(
            &op.op_id,
            SyncErrorCode::UnauthorizedGarmin,
            &error.to_string(),
        ));
    }
    if cur.server_version != conflict.server_version {
        return Ok(reject_result(
            &op.op_id,
            SyncErrorCode::VersionConflict,
            "record advanced after conflict; pull and resolve again",
        ));
    }
    let outcome = accept_update(
        tx,
        auth,
        op,
        cur,
        fingerprint,
        correlation_id,
        &content_hash,
        &snapshot_json,
        tombstone_json.as_deref(),
        &natural_key_json,
        is_tombstone,
        &nk_hash,
    )?;
    ConflictRepo::close(tx, &auth.account_id, conflict_id)?;
    TimelineRepo::append_event(
        tx,
        &auth.account_id,
        &op.op_id,
        Some(correlation_id),
        Some(&op.origin),
        EVENT_RESOLVE,
        &json!({
            "conflictId": conflict_id,
            "status": "accepted",
            "domain": op.domain,
            "recordType": op.record_type,
            "recordId": op.record_id,
        }),
    )?;
    Ok(outcome)
}

fn enforce_existing_source(auth: &AuthContext, op: &SyncChange, current: &CurrentRecord) -> Result<()> {
    let natural_key: Value = serde_json::from_str(&current.natural_key_json)
        .map_err(|_| anyhow!("stored natural key is invalid"))?;
    let stored_source = natural_key
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("manual");
    // Deletes carry no snapshot, so authorization must consult the stored fact
    // rather than an attacker-controlled replacement natural key.  Updates
    // cannot silently turn Garmin facts into manual records (or vice versa).
    if !capabilities::can_write_garmin(auth, stored_source) {
        return Err(anyhow!("UNAUTHORIZED_STORED_GARMIN"));
    }
    if op.kind != "delete" && fact_source(op) != stored_source {
        return Err(anyhow!("SOURCE_TRANSITION_FORBIDDEN"));
    }
    Ok(())
}

fn prepare_wire_payload(op: &SyncChange) -> Result<(String, String, Option<String>, String, bool)> {
    match op.kind.as_str() {
        "delete" => {
            let ts = op.tombstone.as_ref().unwrap();
            let ts_json = serde_json::to_string(ts)?;
            let hash = tombstone_content_hash(&serde_json::to_value(ts)?);
            let nk = crate::canonical::canonical_json(op.natural_key.as_ref().unwrap());
            Ok((hash, ts_json.clone(), Some(ts_json), nk, true))
        }
        "upsert" | "restore" | "resolve" => {
            let snap = op.snapshot.as_ref().unwrap();
            let hash = op
                .content_hash
                .clone()
                .filter(|h| !h.is_empty())
                .unwrap_or_else(|| snapshot_content_hash(&op.record_type, snap).unwrap_or_default());
            let computed = snapshot_content_hash(&op.record_type, snap)?;
            if hash != computed {
                return Err(anyhow!("content_hash mismatch"));
            }
            let nk = crate::canonical::canonical_json(op.natural_key.as_ref().unwrap());
            Ok((hash, serde_json::to_string(snap)?, None, nk, false))
        }
        other => Err(anyhow!("unsupported kind: {other}")),
    }
}

fn accept_new(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    fingerprint: &str,
    correlation_id: &str,
    content_hash: &str,
    snapshot_json: &str,
    tombstone_json: Option<&str>,
    natural_key_json: &str,
    is_tombstone: bool,
    natural_key_hash: &str,
) -> Result<ChangeOutcome> {
    NaturalKeyRepo::rebind(
        tx, &auth.account_id, &op.record_type, &op.record_id, natural_key_hash,
    )?;
    let server_version = 1_i64;
    let change_seq = AccountRepo::next_change_seq(tx, &auth.account_id)?;
    RecordRepo::insert_version(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
        server_version,
        &op.kind,
        content_hash,
        if is_tombstone { None } else { Some(snapshot_json) },
        tombstone_json,
        natural_key_json,
        is_tombstone,
        change_seq,
        &op.op_id,
        Some(&auth.device_id),
    )?;
    RecordRepo::upsert_current(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
        server_version,
        content_hash,
        snapshot_json,
        tombstone_json,
        natural_key_json,
        is_tombstone,
        change_seq,
    )?;
    store_and_return(
        tx,
        auth,
        op,
        fingerprint,
        correlation_id,
        OpStatus::Accepted,
        server_version,
        change_seq,
        None,
    )
}

fn accept_update(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    cur: CurrentRecord,
    fingerprint: &str,
    correlation_id: &str,
    content_hash: &str,
    snapshot_json: &str,
    tombstone_json: Option<&str>,
    natural_key_json: &str,
    is_tombstone: bool,
    natural_key_hash: &str,
) -> Result<ChangeOutcome> {
    if content_hash == cur.content_hash && is_tombstone == cur.is_tombstone {
        return dedupe_op(tx, auth, op, fingerprint, correlation_id, cur);
    }
    NaturalKeyRepo::rebind(
        tx, &auth.account_id, &op.record_type, &op.record_id, natural_key_hash,
    )?;
    let server_version = cur.server_version + 1;
    let change_seq = AccountRepo::next_change_seq(tx, &auth.account_id)?;
    RecordRepo::insert_version(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
        server_version,
        &op.kind,
        content_hash,
        if is_tombstone { None } else { Some(snapshot_json) },
        tombstone_json,
        natural_key_json,
        is_tombstone,
        change_seq,
        &op.op_id,
        Some(&auth.device_id),
    )?;
    RecordRepo::upsert_current(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
        server_version,
        content_hash,
        snapshot_json,
        tombstone_json,
        natural_key_json,
        is_tombstone,
        change_seq,
    )?;
    store_and_return(
        tx,
        auth,
        op,
        fingerprint,
        correlation_id,
        OpStatus::Accepted,
        server_version,
        change_seq,
        None,
    )
}

fn dedupe_op(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    fingerprint: &str,
    correlation_id: &str,
    cur: CurrentRecord,
) -> Result<ChangeOutcome> {
    store_and_return(
        tx,
        auth,
        op,
        fingerprint,
        correlation_id,
        OpStatus::Deduplicated,
        cur.server_version,
        cur.change_seq,
        None,
    )
}

fn conflict_op(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    cur: CurrentRecord,
    fingerprint: &str,
    correlation_id: &str,
    client_hash: &str,
    client_snapshot_json: &str,
) -> Result<ChangeOutcome> {
    let conflict_id = RecordRepo::insert_conflict(
        tx,
        &auth.account_id,
        &op.domain,
        &op.record_type,
        &op.record_id,
        cur.server_version,
        op.base_server_version,
        client_hash,
        client_snapshot_json,
        &cur.content_hash,
        &cur.snapshot_json,
        &auth.device_id,
        &op.op_id,
    )?;
    TimelineRepo::append_event(
        tx,
        &auth.account_id,
        &op.op_id,
        Some(correlation_id),
        Some(&op.origin),
        EVENT_CONFLICT,
        &json!({
            "conflictId": conflict_id,
            "domain": op.domain,
            "recordType": op.record_type,
            "recordId": op.record_id,
            "serverVersion": cur.server_version,
        }),
    )?;
    store_and_return(
        tx,
        auth,
        op,
        fingerprint,
        correlation_id,
        OpStatus::Conflict,
        cur.server_version,
        cur.change_seq,
        Some(conflict_id),
    )
}

fn reject_op(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    fingerprint: &str,
    correlation_id: &str,
    message: &str,
) -> Result<ChangeOutcome> {
    let receipt = OpReceipt {
        op_id: op.op_id.clone(),
        status: "rejected".into(),
        server_version: None,
        change_seq: None,
        conflict_id: None,
    };
    let _ = OperationRepo::store_receipt(
        tx,
        &auth.account_id,
        &op.op_id,
        &auth.device_id,
        fingerprint,
        "rejected",
        &receipt,
        Some(correlation_id),
    );
    Ok(ChangeOutcome {
        op_id: op.op_id.clone(),
        status: OpStatus::Rejected,
        server_version: None,
        change_seq: None,
        conflict_id: None,
        error: Some(SyncErrorBody {
            code: SyncErrorCode::ValidationFailed.as_str().to_string(),
            message: message.to_string(),
            retryable: Some(false),
            details: None,
        }),
    })
}

fn store_and_return(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    fingerprint: &str,
    correlation_id: &str,
    status: OpStatus,
    server_version: i64,
    change_seq: i64,
    conflict_id: Option<String>,
) -> Result<ChangeOutcome> {
    let status_str = match status {
        OpStatus::Accepted => "accepted",
        OpStatus::Deduplicated => "deduplicated",
        OpStatus::Conflict => "conflict",
        OpStatus::Retryable => "retryable",
        OpStatus::Rejected => "rejected",
    };
    let receipt = OpReceipt {
        op_id: op.op_id.clone(),
        status: status_str.into(),
        server_version: Some(server_version),
        change_seq: Some(change_seq),
        conflict_id: conflict_id.clone(),
    };
    OperationRepo::store_receipt(
        tx,
        &auth.account_id,
        &op.op_id,
        &auth.device_id,
        fingerprint,
        status_str,
        &receipt,
        Some(correlation_id),
    )?;
    Ok(ChangeOutcome {
        op_id: op.op_id.clone(),
        status,
        server_version: Some(server_version),
        change_seq: Some(change_seq),
        conflict_id,
        error: None,
    })
}

fn log_timeline_event(
    tx: &rusqlite::Transaction<'_>,
    auth: &AuthContext,
    op: &SyncChange,
    correlation_id: &str,
    result: &ChangeOutcome,
) -> Result<()> {
    if op.kind == "resolve" && result.status == OpStatus::Accepted {
        return Ok(());
    }
    TimelineRepo::append_event(
        tx,
        &auth.account_id,
        &op.op_id,
        Some(correlation_id),
        Some(&op.origin),
        EVENT_PUSH,
        &json!({
            "status": op_status_label(result.status),
            "kind": op.kind,
            "domain": op.domain,
            "recordType": op.record_type,
            "recordId": op.record_id,
            "serverVersion": result.server_version,
            "changeSeq": result.change_seq,
            "conflictId": result.conflict_id,
        }),
    )?;
    Ok(())
}

fn op_status_label(status: OpStatus) -> &'static str {
    match status {
        OpStatus::Accepted => "accepted",
        OpStatus::Deduplicated => "deduplicated",
        OpStatus::Conflict => "conflict",
        OpStatus::Rejected => "rejected",
        OpStatus::Retryable => "retryable",
    }
}

fn reject_result(op_id: &str, code: SyncErrorCode, message: &str) -> ChangeOutcome {
    ChangeOutcome {
        op_id: op_id.to_string(),
        status: OpStatus::Rejected,
        server_version: None,
        change_seq: None,
        conflict_id: None,
        error: Some(SyncErrorBody {
            code: code.as_str().to_string(),
            message: message.to_string(),
            retryable: Some(code.retryable()),
            details: None,
        }),
    }
}

fn receipt_to_result(op_id: &str, receipt: &OpReceipt, deduped: bool) -> ChangeOutcome {
    let status = if deduped {
        OpStatus::Deduplicated
    } else {
        match receipt.status.as_str() {
            "accepted" => OpStatus::Accepted,
            "deduplicated" => OpStatus::Deduplicated,
            "conflict" => OpStatus::Conflict,
            "retryable" => OpStatus::Retryable,
            _ => OpStatus::Rejected,
        }
    };
    ChangeOutcome {
        op_id: op_id.to_string(),
        status,
        server_version: receipt.server_version,
        change_seq: receipt.change_seq,
        conflict_id: receipt.conflict_id.clone(),
        error: None,
    }
}

pub fn pull_changes(
    db: &Arc<Database>,
    auth: &AuthContext,
    req: PullRequest,
    metrics: &Metrics,
    correlation_id: Option<String>,
) -> Result<PullResponse> {
    validate_contract(&req.contract_version)?;
    validate_device(auth, &req.device_id)?;
    validate_pull_request(&req)?;
    metrics.inc_pull();
    let limit = req.limit.unwrap_or(100).min(MAX_PULL_LIMIT);

    let correlation_id = correlation_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    with_transaction(db, |tx| {
        let acknowledged = PullRepo::acknowledged_seq(tx, &auth.account_id, &auth.device_id)?;
        // Pull is intentionally anchored to the client's durable ACK, not an
        // arbitrary cursor. This permits replay of an interrupted page but
        // prevents a client from making the server issue a false high watermark.
        if req.cursor != acknowledged {
            return Err(anyhow!("PULL_CURSOR_NOT_ACKED"));
        }
        let max_seq = PullRepo::max_change_seq(tx, &auth.account_id)?;
        let changes = PullRepo::changes_since(tx, &auth.account_id, req.cursor, limit)?;
        let next_change_seq = changes
            .last()
            .map(|c| c.change_seq)
            .unwrap_or(req.cursor);
        let has_more = next_change_seq < max_seq;

        let mapped: Vec<PullChange> = changes.into_iter().map(map_version_row).collect();
        // Persist the response watermark before it leaves the transaction.  An
        // ACK may only advance to a cursor actually issued to this device.
        PullRepo::mark_issued(
            tx,
            &auth.account_id,
            &auth.device_id,
            next_change_seq,
        )?;
        TimelineRepo::append_event(
            tx,
            &auth.account_id,
            &correlation_id,
            Some(&correlation_id),
            None,
            EVENT_PULL,
            &json!({
                "cursor": req.cursor,
                "changeCount": mapped.len(),
                "nextChangeSeq": next_change_seq,
                "hasMore": has_more,
            }),
        )?;

        let response = PullResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            changes: mapped,
            next_change_seq,
            has_more,
        };
        validate_pull_response(&response)?;
        Ok(response)
    })
}

fn map_version_row(c: VersionRow) -> PullChange {
    let natural_key = serde_json::from_str(&c.natural_key_json).ok();
    let origin = natural_key
        .as_ref()
        .and_then(|nk: &Value| nk.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("server")
        .to_string();
    let base = |kind: String, content_hash: Option<String>, snapshot, tombstone| PullChange {
        op_id: c.op_id,
        contract_version: CONTRACT_VERSION.to_string(),
        domain: c.domain,
        record_type: c.record_type,
        record_id: c.record_id,
        kind,
        origin,
        local_revision: c.server_version,
        server_version: c.server_version,
        change_seq: c.change_seq,
        created_at_utc: c.created_at_utc,
        content_hash,
        snapshot,
        tombstone,
        natural_key,
    };
    if c.is_tombstone {
        base(
            "delete".into(),
            None,
            None,
            c.tombstone_json
                .as_ref()
                .and_then(|j| serde_json::from_str(j).ok()),
        )
    } else {
        base(
            // A resolved conflict delivers the resulting fact, not the private
            // conflict-resolution command (whose conflictId is intentionally
            // not replicated to other devices).
            if c.kind == "resolve" { "upsert".into() } else { c.kind },
            Some(c.content_hash),
            c.snapshot_json
                .as_ref()
                .and_then(|j| serde_json::from_str(j).ok()),
            None,
        )
    }
}

pub fn ack_delivery(
    db: &Arc<Database>,
    auth: &AuthContext,
    req: AckRequest,
    correlation_id: Option<String>,
) -> Result<AckResponse> {
    validate_contract(&req.contract_version)?;
    validate_device(auth, &req.device_id)?;
    validate_ack_request(&req)?;
    if req.delivered_change_seq < 0 {
        return Err(anyhow!("ACK_CURSOR_INVALID"));
    }
    let correlation_id = correlation_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    with_transaction(db, |tx| {
        let issued_seq = PullRepo::max_issued_seq(tx, &auth.account_id, &auth.device_id)?;
        if req.delivered_change_seq > issued_seq {
            return Err(anyhow!("ACK_CURSOR_OUT_OF_RANGE"));
        }
        PullRepo::ack_delivery(
            tx,
            &auth.account_id,
            &auth.device_id,
            req.delivered_change_seq,
        )?;
        TimelineRepo::append_event(
            tx,
            &auth.account_id,
            &correlation_id,
            Some(&correlation_id),
            None,
            EVENT_ACK,
            &json!({
                "deliveredChangeSeq": req.delivered_change_seq,
            }),
        )?;
        let response = AckResponse {
            contract_version: CONTRACT_VERSION.to_string(),
            delivered_change_seq: req.delivered_change_seq,
        };
        validate_ack_response(&response)?;
        Ok(response)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthContext;
    use crate::db::repository::{ensure_test_account, ensure_test_device};
    use crate::db::test_db;
    use crate::metrics::Metrics;
    use serde_json::json;
    use uuid::Uuid;

    fn auth(account: &str, device: &str) -> AuthContext {
        AuthContext {
            account_id: account.into(),
            device_id: device.into(),
            capabilities: vec!["sync".into()],
        }
    }

    fn auth_garmin(account: &str, device: &str) -> AuthContext {
        AuthContext {
            account_id: account.into(),
            device_id: device.into(),
            capabilities: vec!["sync".into(), "garmin_collect".into()],
        }
    }

    fn note_snapshot(record_id: &str, body: &str, revision: i64) -> Value {
        json!({
            "id": record_id,
            "localDate": "2026-01-15",
            "source": "manual",
            "revision": revision,
            "payload": {"body": body},
            "naturalKey": {"id": record_id},
            "createdAtUtc": "2026-01-15T08:00:00Z",
            "updatedAtUtc": "2026-01-15T08:00:00Z",
            "deletedAtUtc": null
        })
    }

    fn note_op(
        op_id: &str,
        record_id: &str,
        base: Option<i64>,
        body: &str,
        kind: &str,
    ) -> SyncChange {
        let snap = note_snapshot(record_id, body, 1);
        let hash = snapshot_content_hash("note", &snap).unwrap();
        SyncChange {
            op_id: op_id.into(),
            contract_version: CONTRACT_VERSION.into(),
            domain: "journal".into(),
            record_type: "note".into(),
            record_id: record_id.into(),
            kind: kind.into(),
            origin: "manual".into(),
            local_revision: 1,
            base_server_version: base,
            content_hash: Some(hash),
            snapshot: Some(snap),
            tombstone: None,
            natural_key: Some(json!({"id": record_id})),
            conflict_id: None,
            created_at_utc: "2026-01-15T08:00:00Z".into(),
        }
    }

    fn push_req(device: &str, changes: Vec<SyncChange>) -> PushRequest {
        PushRequest {
            contract_version: CONTRACT_VERSION.into(),
            device_id: device.into(),
            client_change_seq: 0,
            changes,
        }
    }

    #[test]
    fn accept_new_record() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let record_id = Uuid::new_v4().to_string();
        let req = push_req(&device, vec![note_op(
                &Uuid::new_v4().to_string(),
                &record_id,
                None,
                "hello",
                "upsert",
            )],
        );
        let resp = apply_push_ops(&db, &auth(&account, &device), req, &metrics, None).unwrap();
        assert_eq!(resp.outcomes[0].status, OpStatus::Accepted);
    }

    #[test]
    fn delete_uses_tombstone() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let record_id = Uuid::new_v4().to_string();
        let r1 = apply_push_ops(
            &db,
            &auth(&account, &device),
            push_req(
                &device,
                vec![note_op(
                    &Uuid::new_v4().to_string(),
                    &record_id,
                    None,
                    "hello",
                    "upsert",
                )],
            ),
            &metrics,
            None,
        )
        .unwrap();
        let sv = r1.outcomes[0].server_version.unwrap();
        let del = push_req(
            &device,
            vec![SyncChange {
                op_id: Uuid::new_v4().to_string(),
                contract_version: CONTRACT_VERSION.into(),
                domain: "journal".into(),
                record_type: "note".into(),
                record_id: record_id.clone(),
                kind: "delete".into(),
                origin: "manual".into(),
                local_revision: 2,
                base_server_version: Some(sv),
                content_hash: None,
                snapshot: None,
                tombstone: Some(Tombstone {
                    id: record_id.clone(),
                    revision: 2,
                    deleted_at_utc: "2026-01-15T09:00:00Z".into(),
                }),
                natural_key: Some(json!({"id": record_id})),
                conflict_id: None,
                created_at_utc: "2026-01-15T09:00:00Z".into(),
            }],
        );
        let r2 = apply_push_ops(&db, &auth(&account, &device), del, &metrics, None).unwrap();
        assert_eq!(r2.outcomes[0].status, OpStatus::Accepted);
    }

    #[test]
    fn garmin_activity_delete_uses_natural_key_source() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let record_id = Uuid::new_v4().to_string();
        let nk = json!({"externalId": "g-act-1", "source": "garmin"});
        let mut snap = json!({
            "id": record_id,
            "source": "garmin",
            "externalId": "g-act-1",
            "localDate": "2026-01-15",
            "revision": 1,
            "activity": {"sport": "running", "duration": 60, "metrics": {"startTime": 1}},
            "naturalKey": nk,
            "createdAtUtc": "2026-01-15T08:00:00Z",
            "updatedAtUtc": "2026-01-15T08:00:00Z",
            "deletedAtUtc": null
        });
        let hash = snapshot_content_hash("activity", &snap).unwrap();
        snap.as_object_mut().unwrap().insert(
            "contentHash".into(),
            Value::String(hash.clone()),
        );
        apply_push_ops(
            &db,
            &auth_garmin(&account, &device),
            push_req(
                &device,
                vec![SyncChange {
                    op_id: Uuid::new_v4().to_string(),
                    contract_version: CONTRACT_VERSION.into(),
                    domain: "health".into(),
                    record_type: "activity".into(),
                    record_id: record_id.clone(),
                    kind: "upsert".into(),
                    origin: "garmin".into(),
                    local_revision: 1,
                    base_server_version: None,
                    content_hash: Some(hash),
                    snapshot: Some(snap),
                    tombstone: None,
                    natural_key: Some(nk.clone()),
                    conflict_id: None,
                    created_at_utc: "2026-01-15T08:00:00Z".into(),
                }],
            ),
            &metrics,
            None,
        )
        .unwrap();
        let del = push_req(
            &device,
            vec![SyncChange {
                op_id: Uuid::new_v4().to_string(),
                contract_version: CONTRACT_VERSION.into(),
                domain: "health".into(),
                record_type: "activity".into(),
                record_id: record_id.clone(),
                kind: "delete".into(),
                origin: "garmin".into(),
                local_revision: 2,
                base_server_version: Some(1),
                content_hash: None,
                snapshot: None,
                tombstone: Some(Tombstone {
                    id: record_id.clone(),
                    revision: 2,
                    deleted_at_utc: "2026-01-15T09:00:00Z".into(),
                }),
                natural_key: Some(nk),
                conflict_id: None,
                created_at_utc: "2026-01-15T09:00:00Z".into(),
            }],
        );
        let r = apply_push_ops(&db, &auth_garmin(&account, &device), del, &metrics, None).unwrap();
        assert_eq!(r.outcomes[0].status, OpStatus::Accepted);
    }

    #[test]
    fn natural_key_collision_rejected() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let shared_nk = json!({"id": "00000000-0000-4000-8000-000000000010"});
        let r1 = Uuid::new_v4().to_string();
        let r2 = Uuid::new_v4().to_string();
        let snap = note_snapshot(&r1, "a", 1);
        let hash = snapshot_content_hash("note", &snap).unwrap();
        let first = push_req(
            &device,
            vec![SyncChange {
                op_id: Uuid::new_v4().to_string(),
                contract_version: CONTRACT_VERSION.into(),
                domain: "journal".into(),
                record_type: "note".into(),
                record_id: r1.clone(),
                kind: "upsert".into(),
                origin: "manual".into(),
                local_revision: 1,
                base_server_version: None,
                content_hash: Some(hash.clone()),
                snapshot: Some(snap.clone()),
                tombstone: None,
                natural_key: Some(shared_nk.clone()),
                conflict_id: None,
                created_at_utc: "2026-01-15T08:00:00Z".into(),
            }],
        );
        apply_push_ops(&db, &auth(&account, &device), first, &metrics, None).unwrap();
        let snap2 = note_snapshot(&r2, "b", 1);
        let second = push_req(
            &device,
            vec![SyncChange {
                op_id: Uuid::new_v4().to_string(),
                contract_version: CONTRACT_VERSION.into(),
                domain: "journal".into(),
                record_type: "note".into(),
                record_id: r2,
                kind: "upsert".into(),
                origin: "manual".into(),
                local_revision: 1,
                base_server_version: None,
                content_hash: Some(snapshot_content_hash("note", &snap2).unwrap()),
                snapshot: Some(snap2),
                tombstone: None,
                natural_key: Some(shared_nk),
                conflict_id: None,
                created_at_utc: "2026-01-15T08:00:00Z".into(),
            }],
        );
        let r = apply_push_ops(&db, &auth(&account, &device), second, &metrics, None).unwrap();
        assert_eq!(r.outcomes[0].status, OpStatus::Rejected);
    }

    #[test]
    fn op_id_fingerprint_mismatch_rejected() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let op_id = Uuid::new_v4().to_string();
        let record_id = Uuid::new_v4().to_string();
        let req1 = push_req(&device, vec![note_op(&op_id, &record_id, None, "a", "upsert")]);
        apply_push_ops(&db, &auth(&account, &device), req1, &metrics, None).unwrap();
        let req2 = push_req(&device, vec![note_op(&op_id, &record_id, None, "b", "upsert")]);
        let r = apply_push_ops(&db, &auth(&account, &device), req2, &metrics, None).unwrap();
        assert_eq!(r.outcomes[0].status, OpStatus::Rejected);
    }

    #[test]
    fn pull_does_not_advance_delivery_ack() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let record_id = Uuid::new_v4().to_string();
        apply_push_ops(
            &db,
            &auth(&account, &device),
            push_req(
                &device,
                vec![note_op(
                    &Uuid::new_v4().to_string(),
                    &record_id,
                    None,
                    "x",
                    "upsert",
                )],
            ),
            &metrics,
            None,
        )
        .unwrap();
        let pull = PullRequest {
            contract_version: CONTRACT_VERSION.into(),
            device_id: device.clone(),
            cursor: 0,
            limit: Some(10),
        };
        let p = pull_changes(&db, &auth(&account, &device), pull, &metrics, None).unwrap();
        assert!(!p.changes.is_empty());
        let ack_before: i64 = with_transaction(&db, |tx| {
            Ok(PullRepo::min_delivered_seq(tx, &account).unwrap_or(0))
        })
        .unwrap();
        assert_eq!(ack_before, 0);
        ack_delivery(
            &db,
            &auth(&account, &device),
            AckRequest {
                contract_version: CONTRACT_VERSION.into(),
                device_id: device.clone(),
                delivered_change_seq: p.next_change_seq,
            },
            None,
        )
        .unwrap();
        let ack_after: i64 = with_transaction(&db, |tx| {
            Ok(PullRepo::min_delivered_seq(tx, &account).unwrap_or(0))
        })
        .unwrap();
        assert_eq!(ack_after, p.next_change_seq);
    }

    #[test]
    fn ack_rejects_future_cursor() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        apply_push_ops(
            &db,
            &auth(&account, &device),
            push_req(
                &device,
                vec![note_op(
                    &Uuid::new_v4().to_string(),
                    &Uuid::new_v4().to_string(),
                    None,
                    "x",
                    "upsert",
                )],
            ),
            &metrics,
            None,
        )
        .unwrap();
        let err = ack_delivery(
            &db,
            &auth(&account, &device),
            AckRequest {
                contract_version: CONTRACT_VERSION.into(),
                device_id: device.clone(),
                delivered_change_seq: 999,
            },
            None,
        )
        .unwrap_err();
        assert!(err.to_string().contains("ACK_CURSOR_OUT_OF_RANGE"));
    }

    #[test]
    fn resolve_closes_open_conflict() {
        let db = test_db();
        let account = Uuid::new_v4().to_string();
        let device = Uuid::new_v4().to_string();
        ensure_test_account(&db, &account).unwrap();
        ensure_test_device(&db, &account, &device).unwrap();
        let metrics = Metrics::new();
        let record_id = Uuid::new_v4().to_string();
        apply_push_ops(
            &db,
            &auth(&account, &device),
            push_req(
                &device,
                vec![note_op(
                    &Uuid::new_v4().to_string(),
                    &record_id,
                    None,
                    "v1",
                    "upsert",
                )],
            ),
            &metrics,
            None,
        )
        .unwrap();
        let conflict_push = push_req(
            &device,
            vec![note_op(
                &Uuid::new_v4().to_string(),
                &record_id,
                Some(99),
                "v2",
                "upsert",
            )],
        );
        let conflict_resp =
            apply_push_ops(&db, &auth(&account, &device), conflict_push, &metrics, None).unwrap();
        assert_eq!(conflict_resp.outcomes[0].status, OpStatus::Conflict);
        let conflict_id = conflict_resp.outcomes[0].conflict_id.clone().unwrap();
        let resolved_snap = note_snapshot(&record_id, "resolved", 2);
        let resolve = push_req(
            &device,
            vec![SyncChange {
                op_id: Uuid::new_v4().to_string(),
                contract_version: CONTRACT_VERSION.into(),
                domain: "journal".into(),
                record_type: "note".into(),
                record_id: record_id.clone(),
                kind: "resolve".into(),
                origin: "manual".into(),
                local_revision: 2,
                base_server_version: Some(1),
                content_hash: Some(snapshot_content_hash("note", &resolved_snap).unwrap()),
                snapshot: Some(resolved_snap),
                tombstone: None,
                natural_key: Some(json!({"id": record_id})),
                conflict_id: Some(conflict_id),
                created_at_utc: "2026-01-15T09:00:00Z".into(),
            }],
        );
        let resolved =
            apply_push_ops(&db, &auth(&account, &device), resolve, &metrics, None).unwrap();
        assert_eq!(resolved.outcomes[0].status, OpStatus::Accepted);
        let wrong_account = Uuid::new_v4().to_string();
        ensure_test_account(&db, &wrong_account).unwrap();
        let wrong_device = Uuid::new_v4().to_string();
        ensure_test_device(&db, &wrong_account, &wrong_device).unwrap();
        let cross = push_req(
            &wrong_device,
            vec![SyncChange {
                op_id: Uuid::new_v4().to_string(),
                contract_version: CONTRACT_VERSION.into(),
                domain: "journal".into(),
                record_type: "note".into(),
                record_id,
                kind: "resolve".into(),
                origin: "manual".into(),
                local_revision: 3,
                base_server_version: Some(1),
                content_hash: Some("a".repeat(64)),
                snapshot: Some(json!({
                    "id": "00000000-0000-4000-8000-000000000099",
                    "source": "manual",
                    "localDate": "2026-01-15",
                    "revision": 3,
                    "payload": {"body": "x"},
                    "createdAtUtc": "2026-01-15T08:00:00Z",
                    "updatedAtUtc": "2026-01-15T09:00:00Z"
                })),
                tombstone: None,
                natural_key: Some(json!({"id": "00000000-0000-4000-8000-000000000099"})),
                conflict_id: Some(conflict_resp.outcomes[0].conflict_id.clone().unwrap()),
                created_at_utc: "2026-01-15T09:00:00Z".into(),
            }],
        );
        let cross_resp =
            apply_push_ops(&db, &auth(&wrong_account, &wrong_device), cross, &metrics, None).unwrap();
        assert_eq!(cross_resp.outcomes[0].status, OpStatus::Rejected);
    }
}
