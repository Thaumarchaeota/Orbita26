//! Idempotent receipt and durable materialization lifecycle for E5.
//! The caller holds the app-wide write coordinator and validates all intent
//! hashes/revisions before invoking `commit_once`.

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::finance_v2_domain::Id;
use crate::{finance_v2_projection::{project_ledger, LedgerProjection}, finance_v2_domain::LedgerSnapshot, finance_v2_store::read::read_ledger_snapshot};

use super::{read::advance_ledger_generation, StoreError};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CommitReceipt {
    pub operation_id: Id,
    pub receipt_id: Id,
    pub payload_sha256: String,
    pub generation: u64,
    pub id_map_json: String,
    pub committed_at_utc_us: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MaterializationJob {
    pub job_id: Id,
    pub operation_id: Id,
    pub generation: u64,
    pub status: MaterializationStatus,
    pub input_sha256: String,
    pub output_sha256: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub created_at_utc_us: i64,
    pub updated_at_utc_us: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaterializationStatus { Pending, Running, Ready, Failed }

pub fn record_l0_change(tx: &rusqlite::Transaction<'_>, fact_id: &Id, revision: u64, operation_id: &Id, at_utc_us: i64, reason: &str) -> Result<(), StoreError> {
    if reason.trim().is_empty() { return Err(StoreError::InvalidDomainValue); }
    tx.execute("INSERT INTO finance_v2_l0_change_audit(fact_id,revision,operation_id,changed_at_utc_us,reason) VALUES (?1,?2,?3,?4,?5)", params![fact_id.as_str(),i64::try_from(revision).map_err(|_|StoreError::InvalidDomainValue)?,operation_id.as_str(),at_utc_us,reason])?;
    Ok(())
}

pub fn record_treatment_change(tx: &rusqlite::Transaction<'_>, treatment_id: &Id, revision: u64, operation_id: &Id, at_utc_us: i64, reason: &str) -> Result<(), StoreError> {
    if reason.trim().is_empty() { return Err(StoreError::InvalidDomainValue); }
    tx.execute("INSERT INTO finance_v2_treatment_change_audit(treatment_id,revision,operation_id,changed_at_utc_us,reason) VALUES (?1,?2,?3,?4,?5)", params![treatment_id.as_str(),i64::try_from(revision).map_err(|_|StoreError::InvalidDomainValue)?,operation_id.as_str(),at_utc_us,reason])?;
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CommitResult {
    pub receipt: CommitReceipt,
    pub job: MaterializationJob,
    pub already_committed: bool,
}

/// All domain writes supplied by `write_facts` and the immutable receipt/job
/// are committed together. An idempotent retry never calls `write_facts`.
pub fn commit_once<F>(
    connection: &mut Connection,
    operation_id: &Id,
    receipt_id: &Id,
    job_id: &Id,
    payload_sha256: &str,
    expected_generation: u64,
    committed_at_utc_us: i64,
    write_facts: F,
) -> Result<CommitResult, StoreError>
where F: FnOnce(&rusqlite::Transaction<'_>) -> Result<serde_json::Value, StoreError> {
    commit_once_verified(
        connection, operation_id, receipt_id, job_id, payload_sha256,
        expected_generation, committed_at_utc_us, write_facts,
        |_, _, _| Ok(()),
    )
}

/// Verified form of `commit_once`. The verifier runs after all proposed rows,
/// generation advance, Imported-link checks, and E4 ledger projection have
/// been computed inside the same IMMEDIATE transaction, but before receipt/job
/// insertion or transaction commit. It can reject a mismatch without leaving
/// formal SQLite changes behind.
pub fn commit_once_verified<F, V>(
    connection: &mut Connection,
    operation_id: &Id,
    receipt_id: &Id,
    job_id: &Id,
    payload_sha256: &str,
    expected_generation: u64,
    committed_at_utc_us: i64,
    write_facts: F,
    verify_projection: V,
) -> Result<CommitResult, StoreError>
where
    F: FnOnce(&rusqlite::Transaction<'_>) -> Result<serde_json::Value, StoreError>,
    V: FnOnce(&rusqlite::Transaction<'_>, &LedgerSnapshot, &LedgerProjection) -> Result<(), StoreError>,
{
    validate_hash(payload_sha256)?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(existing) = read_receipt_by_operation(&tx, operation_id)? {
        if existing.payload_sha256 != payload_sha256 { return Err(StoreError::OperationConflict); }
        let job = read_job_by_operation(&tx, operation_id)?.ok_or(StoreError::IncompatibleSchema)?;
        tx.commit()?;
        return Ok(CommitResult { receipt: existing, job, already_committed: true });
    }
    let now: i64 = tx.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1", [], |r| r.get(0))?;
    let now = u64::try_from(now).map_err(|_| StoreError::IncompatibleSchema)?;
    if now != expected_generation { return Err(StoreError::GenerationConflict); }

    let id_map = write_facts(&tx)?;
    super::evidence::validate_occurrence_claims(&tx)?;
    let generation = advance_ledger_generation(&tx)?;
    super::l0::validate_all_active_imported_links(&tx)?;
    let snapshot = read_ledger_snapshot(&tx)?;
    let projection = project_ledger(&snapshot).map_err(|_| StoreError::InvalidDomainValue)?;
    verify_projection(&tx, &snapshot, &projection)?;
    let id_map_json = serde_json::to_string(&id_map).map_err(|_| StoreError::InvalidDomainValue)?;
    tx.execute(
        "INSERT INTO finance_v2_commit_receipts(operation_id,receipt_id,payload_sha256,committed_generation,id_map_json,committed_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6)",
        params![operation_id.as_str(), receipt_id.as_str(), payload_sha256, i64::try_from(generation).map_err(|_| StoreError::InvalidDomainValue)?, id_map_json, committed_at_utc_us],
    )?;
    tx.execute(
        "INSERT INTO finance_v2_materialization_jobs(job_id,operation_id,generation,status,input_sha256,created_at_utc_us,updated_at_utc_us) VALUES (?1,?2,?3,'pending',?4,?5,?5)",
        params![job_id.as_str(), operation_id.as_str(), i64::try_from(generation).map_err(|_| StoreError::InvalidDomainValue)?, payload_sha256, committed_at_utc_us],
    )?;
    let receipt = CommitReceipt { operation_id: operation_id.clone(), receipt_id: receipt_id.clone(), payload_sha256: payload_sha256.to_owned(), generation, id_map_json, committed_at_utc_us };
    let job = MaterializationJob { job_id: job_id.clone(), operation_id: operation_id.clone(), generation, status: MaterializationStatus::Pending, input_sha256: payload_sha256.to_owned(), output_sha256: None, error_code: None, error_detail: None, created_at_utc_us: committed_at_utc_us, updated_at_utc_us: committed_at_utc_us };
    tx.commit()?;
    Ok(CommitResult { receipt, job, already_committed: false })
}

pub fn find_receipt(connection: &Connection, operation_id: &Id) -> Result<Option<CommitReceipt>, StoreError> {
    read_receipt_by_operation(connection, operation_id)
}

pub fn find_job(connection: &Connection, job_id: &Id) -> Result<Option<MaterializationJob>, StoreError> {
    let row = connection.query_row("SELECT job_id,operation_id,generation,status,input_sha256,output_sha256,error_code,error_detail,created_at_utc_us,updated_at_utc_us FROM finance_v2_materialization_jobs WHERE job_id=?1", [job_id.as_str()], decode_job).optional()?;
    row.map(decode_job_row).transpose()
}

pub fn find_job_by_operation(connection: &Connection, operation_id: &Id) -> Result<Option<MaterializationJob>, StoreError> {
    let row = connection.query_row("SELECT job_id,operation_id,generation,status,input_sha256,output_sha256,error_code,error_detail,created_at_utc_us,updated_at_utc_us FROM finance_v2_materialization_jobs WHERE operation_id=?1", [operation_id.as_str()], decode_job).optional()?;
    row.map(decode_job_row).transpose()
}

pub fn find_job_by_generation(connection: &Connection, generation: u64) -> Result<Option<MaterializationJob>, StoreError> {
    let generation = i64::try_from(generation).map_err(|_| StoreError::InvalidDomainValue)?;
    let row = connection.query_row("SELECT job_id,operation_id,generation,status,input_sha256,output_sha256,error_code,error_detail,created_at_utc_us,updated_at_utc_us FROM finance_v2_materialization_jobs WHERE generation=?1", [generation], decode_job).optional()?;
    row.map(decode_job_row).transpose()
}

/// State transitions are compare-and-set and never alter receipt or input hash.
pub fn update_job(
    connection: &mut Connection,
    job_id: &Id,
    expected: MaterializationStatus,
    next: MaterializationStatus,
    output_sha256: Option<&str>,
    error_code: Option<&str>,
    error_detail: Option<&str>,
    updated_at_utc_us: i64,
) -> Result<(), StoreError> {
    if let Some(hash) = output_sha256 { validate_hash(hash)?; }
    let valid = matches!((expected, next), (MaterializationStatus::Pending, MaterializationStatus::Running)
        | (MaterializationStatus::Running, MaterializationStatus::Ready)
        | (MaterializationStatus::Running, MaterializationStatus::Failed)
        | (MaterializationStatus::Failed, MaterializationStatus::Running)
        | (MaterializationStatus::Ready, MaterializationStatus::Running));
    if !valid || (next == MaterializationStatus::Ready && output_sha256.is_none()) { return Err(StoreError::InvalidDomainValue); }
    let status = encode_status(next);
    let changed = connection.execute("UPDATE finance_v2_materialization_jobs SET status=?2,output_sha256=?3,error_code=?4,error_detail=?5,updated_at_utc_us=?6 WHERE job_id=?1 AND status=?7", params![job_id.as_str(), status, output_sha256, error_code, error_detail, updated_at_utc_us, encode_status(expected)])?;
    if changed != 1 { return Err(StoreError::StaleRevision); }
    Ok(())
}

fn read_receipt_by_operation(connection: &Connection, operation_id: &Id) -> Result<Option<CommitReceipt>, StoreError> {
    connection.query_row("SELECT receipt_id,payload_sha256,committed_generation,id_map_json,committed_at_utc_us FROM finance_v2_commit_receipts WHERE operation_id=?1", [operation_id.as_str()], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?))).optional()?.map(|(receipt,hash,generation,id_map,time)| Ok(CommitReceipt { operation_id: operation_id.clone(), receipt_id: parse_id(receipt)?, payload_sha256: hash, generation: to_u64(generation)?, id_map_json: id_map, committed_at_utc_us: time })).transpose()
}

fn read_job_by_operation(connection: &Connection, operation_id: &Id) -> Result<Option<MaterializationJob>, StoreError> {
    let row = connection.query_row("SELECT job_id,operation_id,generation,status,input_sha256,output_sha256,error_code,error_detail,created_at_utc_us,updated_at_utc_us FROM finance_v2_materialization_jobs WHERE operation_id=?1", [operation_id.as_str()], decode_job).optional()?;
    row.map(decode_job_row).transpose()
}

type JobRow = (String,String,i64,String,String,Option<String>,Option<String>,Option<String>,i64,i64);
fn decode_job(r: &rusqlite::Row<'_>) -> rusqlite::Result<JobRow> { Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?)) }
fn decode_job_row(row: JobRow) -> Result<MaterializationJob, StoreError> {
    let (id,operation,generation,status,input,output,error,detail,created,updated)=row;
    let status=match status.as_str(){"pending"=>MaterializationStatus::Pending,"running"=>MaterializationStatus::Running,"ready"=>MaterializationStatus::Ready,"failed"=>MaterializationStatus::Failed,_=>return Err(StoreError::IncompatibleSchema)};
    Ok(MaterializationJob { job_id:parse_id(id)?, operation_id:parse_id(operation)?, generation:to_u64(generation)?, status, input_sha256:input, output_sha256:output, error_code:error, error_detail:detail, created_at_utc_us:created, updated_at_utc_us:updated })
}
fn validate_hash(value:&str)->Result<(),StoreError>{if value.len()==64&&value.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){Ok(())}else{Err(StoreError::InvalidDomainValue)}}
fn parse_id(value:String)->Result<Id,StoreError>{Id::parse(value).map_err(|_|StoreError::IncompatibleSchema)}
fn to_u64(value:i64)->Result<u64,StoreError>{u64::try_from(value).map_err(|_|StoreError::IncompatibleSchema)}
fn encode_status(value:MaterializationStatus)->&'static str{match value{MaterializationStatus::Pending=>"pending",MaterializationStatus::Running=>"running",MaterializationStatus::Ready=>"ready",MaterializationStatus::Failed=>"failed"}}
