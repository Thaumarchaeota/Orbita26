use std::{
    fs,
    path::Path,
    collections::BTreeSet,
    cell::RefCell,
};

use tauri::AppHandle;
use sha2::{Digest,Sha256};

use crate::{
    finance_v2_domain::Id,
    finance_v2_projection::{project_ledger, project_reports},
    finance_v2_store::{commit::{commit_once,commit_once_verified,find_job_by_generation,find_job_by_operation,find_receipt,update_job,CommitReceipt,MaterializationJob,MaterializationStatus},read::read_ledger_snapshot,schema},
    finance_v2_workspace::{self,draft::{DraftCommitState,DraftRepository,IsolatedWorkspaceRoot,MaterializationReadyProof,ReceiptNotFound},refinement::{record_commit_receipt,DraftCommitPlan}},
};

use super::{session::{finance_v2_write_lock,open_store, verify_session, FinanceV2Session},wire::{AbandonDraftRequest,CommitBatchRequest,CommitBatchResponse,PrepareCommitRequest,PreparedCommitResponse,RecoverMaterializationRequest,RecoverMaterializationResponse}};

/// Builds a disposable, marker-backed sibling root for no-write commit
/// preflight.  SQLite's backup API is used so the copy includes a consistent
/// database image even if the source connection uses WAL mode.
fn isolated_preflight_copy(root: &IsolatedWorkspaceRoot) -> Result<(IsolatedWorkspaceRoot, rusqlite::Connection), String> {
    let name = format!(".finance-v2-preflight-{}", Id::new().as_str());
    let path = root.path().join(&name);
    let copy_root = IsolatedWorkspaceRoot::create(&path, root.workspace_id().clone(), root.ledger_identity().clone())
        .map_err(|e| format!("preflight root create failed: {e:?}"))?;
    let result = (|| {
        let copy_connection = open_store(&copy_root)?;
        drop(copy_connection);
        let source = open_store(root)?;
        let destination_path = copy_root.path().join("finance-v2.sqlite3");
        let mut destination = rusqlite::Connection::open(&destination_path).map_err(|e| e.to_string())?;
        let mut backup = rusqlite::backup::Backup::new(&source, &mut destination)
            .map_err(|_| "preflight database snapshot failed".to_owned())?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(250), None)
            .map_err(|_| "preflight database snapshot failed".to_owned())?;
        drop(backup);
        destination.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
        drop(destination);
        let copy_connection = open_store(&copy_root)?;
        schema::validate(&copy_connection).map_err(|e| format!("preflight schema invalid: {e:?}"))?;
        Ok(copy_connection)
    })();
    match result {
        Ok(connection) => Ok((copy_root, connection)),
        Err(error) => {
            let _ = remove_preflight_copy(root, copy_root);
            Err(error)
        }
    }
}

/// Removes only a newly-created direct child with the preflight prefix. Every
/// descendant is checked before removal so a substituted link cannot escape
/// the isolated root.
fn remove_preflight_copy(main_root: &IsolatedWorkspaceRoot, copy_root: IsolatedWorkspaceRoot) -> Result<(), String> {
    let path = copy_root.path().to_owned();
    if path.parent() != Some(main_root.path()) || !path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(".finance-v2-preflight-")) {
        return Err("preflight cleanup path escaped its isolated root".into());
    }
    remove_tree_without_links(&path)
}

fn remove_tree_without_links(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("preflight cleanup found a symlink or reparse point".into());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            remove_tree_without_links(&entry.path())?;
        }
        fs::remove_dir(path).map_err(|e| e.to_string())
    } else if metadata.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())
    } else {
        Err("preflight cleanup found an unsupported filesystem object".into())
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x0400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool { false }

#[derive(Clone, Debug)]
struct PreflightProof {
    projection_sha256: String,
    manifest_sha256: String,
}

fn projection_digest(
    snapshot: &crate::finance_v2_domain::LedgerSnapshot,
    ledger: &crate::finance_v2_projection::LedgerProjection,
    report: &crate::finance_v2_projection::ReportProjection,
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(snapshot, ledger, report)).map_err(|_| "projection serialization failed")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn make_prepare_token(session: &FinanceV2Session, plan: &DraftCommitPlan, proof: &PreflightProof, recorded_at_utc_us:i64) -> String {
    let raw = format!("{}|{}|{}|{}|{}|{}|{}|{}", session.workspace_id.as_str(), plan.draft_id.as_str(),
        plan.operation_id.as_str(), plan.payload_sha256, plan.ledger_generation, recorded_at_utc_us, proof.projection_sha256, proof.manifest_sha256);
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

fn verify_plan_materials(
    root: &IsolatedWorkspaceRoot,
    tx: &rusqlite::Transaction<'_>,
    plan: &DraftCommitPlan,
) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for row in &plan.fixed_parse {
        if !seen.insert(row.artifact_id.clone()) { continue; }
        let artifact = crate::finance_v2_store::sources::find_artifact(tx, &row.artifact_id)
            .map_err(|e| format!("artifact metadata read failed: {e:?}"))?
            .ok_or_else(|| "source artifact metadata is missing".to_owned())?;
        if artifact.sha256 != row.artifact_sha256 || artifact.byte_length != row.artifact_byte_length {
            return Err("source artifact metadata changed after parsing".into());
        }
        let path = super::session::guarded_root_path(root, &artifact.relative_path)?;
        let metadata = fs::symlink_metadata(&path).map_err(|e| format!("source artifact unavailable: {e}"))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file()
            || metadata.len() != artifact.byte_length || metadata.len() > 64 * 1024 * 1024
        { return Err("source artifact path or size failed isolation validation".into()); }
        let bytes = fs::read(&path).map_err(|e| format!("source artifact read failed: {e}"))?;
        if bytes.len() as u64 != artifact.byte_length || format!("{:x}", Sha256::digest(&bytes)) != artifact.sha256 {
            return Err("source artifact hash changed after parsing".into());
        }
    }
    Ok(())
}

/// Execute the complete E3 plan against a consistent disposable SQLite copy,
/// then run the same E4 projection and isolated Beancount validator used for
/// publication. The caller holds the shared coordinator while taking the
/// source copy and persisting the prepared draft.
fn preflight_plan(
    root: &IsolatedWorkspaceRoot,
    plan: &DraftCommitPlan,
    recorded_at_utc_us: i64,
) -> Result<PreflightProof, String> {
    let (copy_root, mut connection) = isolated_preflight_copy(root)?;
    let result = (|| {
        let material_tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
        verify_plan_materials(root, &material_tx, plan)?;
        material_tx.commit().map_err(|e| e.to_string())?;
        let receipt_id = Id::new();
        let job_id = Id::new();
        commit_once(
            &mut connection,
            &plan.operation_id,
            &receipt_id,
            &job_id,
            &plan.payload_sha256,
            plan.ledger_generation,
            recorded_at_utc_us,
            |tx| {
                let applied = super::commit_apply::apply_commit_plan(tx, plan, recorded_at_utc_us)?;
                Ok(applied.id_map)
            },
        ).map_err(|e| format!("preflight transaction rejected: {e:?}"))?;

        let read_tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
        let snapshot = read_ledger_snapshot(&read_tx).map_err(|e| format!("preflight snapshot failed: {e:?}"))?;
        let ledger = project_ledger(&snapshot).map_err(|e| format!("preflight projection failed: {e:?}"))?;
        let report = project_reports(&snapshot, &ledger).map_err(|e| format!("preflight reports failed: {e:?}"))?;
        read_tx.commit().map_err(|e| e.to_string())?;
        let projection_sha256 = projection_digest(&snapshot, &ledger, &report)?;
        let staged = super::materialize::prepare_materialization(&copy_root, &snapshot, &ledger, &report, snapshot.generation)
            .map_err(|e| format!("preflight Beancount validation failed: {e}"))?;
        Ok(PreflightProof { projection_sha256, manifest_sha256: staged.manifest_sha256 })
    })();
    drop(connection);
    let cleanup = remove_preflight_copy(root, copy_root);
    match (result, cleanup) {
        (Ok(hash), Ok(())) => Ok(hash),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(format!("preflight cleanup failed: {error}")),
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct ReceiptLookupResponse { pub receipt: Option<CommitReceipt>, pub materialization_job: Option<MaterializationJob> }

#[tauri::command]
pub fn finance_v2_find_receipt(app:AppHandle,session:FinanceV2Session,operation_id:Id)->Result<ReceiptLookupResponse,String>{
    let root=verify_session(&app,&session)?;
    let connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let receipt=find_receipt(&connection,&operation_id).map_err(|e|e.to_string())?;
    let materialization_job=find_job_by_operation(&connection,&operation_id).map_err(|e|e.to_string())?;
    Ok(ReceiptLookupResponse{receipt,materialization_job})
}

#[tauri::command]
pub fn finance_v2_prepare_commit(app:AppHandle,request:PrepareCommitRequest)->Result<PreparedCommitResponse,String>{
    let _write=finance_v2_write_lock()?;
    let root=verify_session(&app,&request.session)?;
    let connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let tx=connection.unchecked_transaction().map_err(|e|e.to_string())?;
    let base=read_ledger_snapshot(&tx).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    let repo=DraftRepository::open(root.clone());
    let mut draft=repo.load(&request.draft_id).map_err(|e|format!("draft load failed: {e:?}"))?.ok_or_else(||"draft not found".to_owned())?;
    if draft.draft_revision!=request.expected_draft_revision||draft.durable_revision!=request.expected_draft_revision{return Err("draft revision changed; reload before preparing commit".into())}
    if draft.ledger_identity!=request.session.ledger_identity{return Err("draft belongs to a different isolated ledger".into())}
    let prior_durable=draft.durable_revision;
    let plan=finance_v2_workspace::prepare_commit_plan(&mut draft,&base).map_err(|e|format!("commit plan blocked: {e:?}"))?;
    let mut preview_plan=plan.clone();
    preview_plan.durable_revision=preview_plan.required_durable_revision;
    let recorded_at_utc_us=chrono::Utc::now().timestamp_micros();
    let preflight=preflight_plan(&root,&preview_plan,recorded_at_utc_us)?;
    let draft=if draft.draft_revision!=prior_durable{repo.persist(&draft,prior_durable).map_err(|e|format!("prepared draft CAS failed: {e:?}"))?}else{draft};
    if plan.required_durable_revision!=draft.durable_revision{return Err("prepared revision is not durable".into())}
    let prepare_token=make_prepare_token(&request.session,&plan,&preflight,recorded_at_utc_us);
    Ok(PreparedCommitResponse{plan,prepare_token,durable_revision:draft.durable_revision,recorded_at_utc_us})
}

fn persist_receipt_to_draft(repo: &DraftRepository, draft_id: &Id, receipt: &CommitReceipt) -> Result<u64, String> {
    let mut draft = repo.load(draft_id).map_err(|e| format!("draft load failed after receipt: {e:?}"))?.ok_or_else(|| "committed draft disappeared".to_owned())?;
    let old_durable = draft.durable_revision;
    record_commit_receipt(&mut draft, &receipt.operation_id, receipt.receipt_id.as_str().to_owned())
        .map_err(|e| format!("draft receipt record failed: {e:?}"))?;
    if draft.draft_revision == old_durable { Ok(old_durable) }
    else { repo.persist(&draft, old_durable).map(|saved| saved.durable_revision).map_err(|e| format!("draft receipt persistence failed: {e:?}")) }
}

fn ensure_draft_receipt(repo:&DraftRepository,draft_id:&Id,receipt:&CommitReceipt)->Result<(),String>{
    if let Some(marker)=repo.finalized_receipt(draft_id).map_err(|e|format!("finalized marker read failed: {e:?}"))? {
        if marker.operation_id!=receipt.operation_id || marker.receipt_id!=receipt.receipt_id {
            return Err("finalized draft marker disagrees with durable receipt".into())
        }
        return Ok(())
    }
    persist_receipt_to_draft(repo,draft_id,receipt).map(|_|())
}

fn existing_receipt_pending_error(repo:&DraftRepository,draft_id:Option<&Id>,receipt:&CommitReceipt,job:&MaterializationJob)->Option<String>{
    if job.status!=MaterializationStatus::Ready{return Some("receipt exists; materialization recovery is required".into())}
    let Some(draft_id)=draft_id else{return None};
    match repo.finalized_receipt(draft_id){
        Ok(Some(marker)) if marker.operation_id==receipt.operation_id && marker.receipt_id==receipt.receipt_id=>None,
        Ok(Some(_))=>Some("receipt exists but finalized draft marker disagrees; recovery is required".into()),
        Ok(None)=>Some("materialization is ready but workspace finalization is pending; invoke recovery".into()),
        Err(error)=>Some(format!("receipt exists but workspace finalization state could not be read: {error:?}")),
    }
}

fn mark_materialization_failed(
    connection: &mut rusqlite::Connection,
    job: &MaterializationJob,
    detail: &str,
    at: i64,
) -> Result<MaterializationJob, String> {
    let current = crate::finance_v2_store::commit::find_job(connection, &job.job_id)
        .map_err(|e| format!("materialization job read failed: {e:?}"))?.ok_or_else(|| "materialization job missing".to_owned())?;
    if current.status == MaterializationStatus::Running {
        update_job(connection, &current.job_id, MaterializationStatus::Running, MaterializationStatus::Failed, None,
            Some("materialization_failed"), Some(detail), at).map_err(|e| format!("materialization failure state write failed: {e:?}"))?;
    }
    crate::finance_v2_store::commit::find_job(connection, &job.job_id)
        .map_err(|e| format!("materialization job read failed: {e:?}"))?.ok_or_else(|| "materialization job missing".to_owned())
}

/// Commit only after a full plan has passed against an isolated SQLite backup.
/// An existing receipt is checked before any apply helper is invoked, so a lost
/// response can never replay inserted facts or evidence.
#[tauri::command]
pub fn finance_v2_commit_batch(app: AppHandle, request: CommitBatchRequest) -> Result<CommitBatchResponse, String> {
    let write_guard = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let mut connection = open_store(&root)?;
    schema::validate(&connection).map_err(|e| format!("schema validation failed: {e:?}"))?;

    if let Some(receipt) = find_receipt(&connection, &request.operation_id).map_err(|e| format!("receipt lookup failed: {e:?}"))? {
        if receipt.payload_sha256 != request.payload_sha256 { return Err("operation id is already committed with a different payload".into()); }
        let job = find_job_by_operation(&connection, &request.operation_id).map_err(|e| format!("job lookup failed: {e:?}"))?.ok_or_else(|| "receipt has no materialization job".to_owned())?;
        let draft_id = serde_json::from_str::<serde_json::Value>(&receipt.id_map_json).ok()
            .and_then(|v| v.get("draftId").and_then(serde_json::Value::as_str).map(str::to_owned))
            .and_then(|raw| Id::parse(raw).ok());
        if draft_id.as_ref().is_some_and(|id| id != &request.draft_id) { return Err("operation receipt belongs to a different draft".into()); }
        let repo=DraftRepository::open(root);
        let draft_sync_error = if let Some(draft_id) = draft_id.as_ref() {
            ensure_draft_receipt(&repo, draft_id, &receipt).err()
        } else { Some("receipt does not contain a valid draft identity".into()) };
        let materialization_error = draft_sync_error.or_else(|| existing_receipt_pending_error(&repo,draft_id.as_ref(),&receipt,&job));
        return Ok(CommitBatchResponse { receipt, materialization_job: job, already_committed: true,
            materialization_error });
    }

    let read_tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    let base = read_ledger_snapshot(&read_tx).map_err(|e| format!("ledger snapshot failed: {e:?}"))?;
    read_tx.commit().map_err(|e| e.to_string())?;
    let repo = DraftRepository::open(root.clone());
    let mut draft = repo.load(&request.draft_id).map_err(|e| format!("draft load failed: {e:?}"))?.ok_or_else(|| "draft not found".to_owned())?;
    if draft.draft_revision != request.expected_draft_revision || draft.durable_revision != request.expected_draft_revision {
        return Err("draft revision changed; reload before committing".into());
    }
    if draft.ledger_identity != request.session.ledger_identity { return Err("draft belongs to a different isolated ledger".into()); }
    let plan = finance_v2_workspace::prepare_commit_plan(&mut draft, &base).map_err(|e| format!("commit plan blocked: {e:?}"))?;
    if plan.operation_id != request.operation_id || plan.payload_sha256 != request.payload_sha256
        || plan.required_durable_revision != draft.durable_revision || plan.ledger_generation != base.generation {
        return Err("prepared operation, payload, revision, or ledger generation changed".into());
    }
    let preview = preflight_plan(&root, &plan, request.recorded_at_utc_us)?;
    if make_prepare_token(&request.session, &plan, &preview, request.recorded_at_utc_us) != request.prepare_token {
        return Err("prepare token is stale or invalid".into());
    }

    let receipt_id = Id::new();
    let job_id = Id::new();
    let staged_after_commit = RefCell::new(None);
    let committed = commit_once_verified(
        &mut connection, &plan.operation_id, &receipt_id, &job_id, &plan.payload_sha256,
        plan.ledger_generation, request.recorded_at_utc_us,
        |tx| {
            let applied = super::commit_apply::apply_commit_plan(tx, &plan, request.recorded_at_utc_us)?;
            let mut map = applied.id_map;
            if let Some(object) = map.as_object_mut() { object.insert("draftId".into(), serde_json::Value::String(plan.draft_id.as_str().to_owned())); }
            Ok(map)
        },
        |tx, snapshot, ledger| {
            verify_plan_materials(&root, tx, &plan).map_err(|_| crate::finance_v2_store::StoreError::StaleRevision)?;
            let report = project_reports(snapshot, ledger).map_err(|_| crate::finance_v2_store::StoreError::InvalidDomainValue)?;
            let digest = projection_digest(snapshot, ledger, &report).map_err(|_| crate::finance_v2_store::StoreError::InvalidDomainValue)?;
            if digest != preview.projection_sha256 { return Err(crate::finance_v2_store::StoreError::GenerationConflict); }
            *staged_after_commit.borrow_mut() = Some(snapshot.clone());
            Ok(())
        },
    ).map_err(|e| format!("atomic commit rejected: {e:?}"))?;
    if committed.already_committed {
        let draft_sync = ensure_draft_receipt(&repo, &plan.draft_id, &committed.receipt);
        let materialization_error = draft_sync.err().or_else(||existing_receipt_pending_error(&repo,Some(&plan.draft_id),&committed.receipt,&committed.job));
        return Ok(CommitBatchResponse { receipt: committed.receipt, materialization_job: committed.job,
            already_committed: true, materialization_error });
    }

    let durable_revision = persist_receipt_to_draft(&repo, &plan.draft_id, &committed.receipt);
    let now = chrono::Utc::now().timestamp_micros();
    if let Err(error) = update_job(&mut connection, &committed.job.job_id, MaterializationStatus::Pending, MaterializationStatus::Running,
        None, None, None, now) {
        let job=crate::finance_v2_store::commit::find_job(&connection,&committed.job.job_id).ok().flatten().unwrap_or(committed.job.clone());
        return Ok(CommitBatchResponse { receipt:committed.receipt,materialization_job:job,already_committed:false,
            materialization_error:Some(format!("receipt committed; materialization start requires recovery: {error:?}")) });
    }
    let materialization_result = (|| -> Result<(crate::finance_v2_commands::materialize::MaterializationResult, String), String> {
        let snapshot = staged_after_commit.into_inner().ok_or_else(|| "committed projection snapshot missing".to_owned())?;
        let ledger = project_ledger(&snapshot).map_err(|e| format!("committed projection failed: {e:?}"))?;
        let report = project_reports(&snapshot, &ledger).map_err(|e| format!("committed report projection failed: {e:?}"))?;
        let staged = super::materialize::prepare_materialization(&root, &snapshot, &ledger, &report, snapshot.generation)?;
        if staged.manifest_sha256 != preview.manifest_sha256 { return Err("materialized output differs from the validated preview".into()); }
        let published = super::materialize::publish_materialization(&root, &staged, &write_guard, snapshot.generation)?;
        Ok((published, staged.manifest_sha256))
    })();
    let (published, manifest_sha256) = match materialization_result {
        Ok(value) => value,
        Err(error) => {
            let failed = mark_materialization_failed(&mut connection, &committed.job, &error, chrono::Utc::now().timestamp_micros())?;
            let error=match durable_revision { Ok(_)=>error,Err(draft_error)=>format!("{error}; draft receipt sync pending: {draft_error}") };
            return Ok(CommitBatchResponse { receipt: committed.receipt, materialization_job: failed,
                already_committed: false, materialization_error: Some(error) });
        }
    };
    update_job(&mut connection, &committed.job.job_id, MaterializationStatus::Running, MaterializationStatus::Ready,
        Some(&manifest_sha256), None, None, chrono::Utc::now().timestamp_micros())
        .map_err(|e| format!("materialization ready state failed: {e:?}"))?;
    let ready_job = crate::finance_v2_store::commit::find_job(&connection, &committed.job.job_id)
        .map_err(|e| format!("ready job lookup failed: {e:?}"))?.ok_or_else(|| "ready job missing".to_owned())?;
    let proof = MaterializationReadyProof::verified(
        committed.receipt.operation_id.clone(), committed.receipt.receipt_id.clone(), committed.receipt.generation,
        committed.receipt.payload_sha256.clone(), ready_job.generation,
        ready_job.output_sha256.clone().ok_or_else(|| "ready job has no output hash".to_owned())?,
        published.generation, published.manifest_sha256.clone(),
    ).map_err(|e| format!("materialization finalization proof rejected: {e:?}"))?;
    let durable_revision=match durable_revision {
        Ok(revision)=>revision,
        Err(_) => persist_receipt_to_draft(&repo,&plan.draft_id,&committed.receipt).map_err(|error|
            format!("materialization ready but workspace receipt sync remains recoverable: {error}"))?,
    };
    repo.finalize_after_materialized(&plan.draft_id, &proof, durable_revision)
        .map_err(|e| format!("workspace finalization cleanup remains recoverable: {e:?}"))?;
    Ok(CommitBatchResponse { receipt: committed.receipt, materialization_job: ready_job,
        already_committed: false, materialization_error: None })
}

fn ensure_job_running(connection: &mut rusqlite::Connection, job: &MaterializationJob, at: i64) -> Result<(), String> {
    if job.status == MaterializationStatus::Running { return Ok(()); }
    update_job(connection, &job.job_id, job.status, MaterializationStatus::Running, None, None, None, at)
        .map_err(|e| format!("materialization recovery start failed: {e:?}"))
}

/// Repairs only materialized output for an already committed receipt. It
/// projects the latest generation and never invokes `commit_apply_plan`.
#[tauri::command]
pub fn finance_v2_recover_materialization(
    app: AppHandle,
    request: RecoverMaterializationRequest,
) -> Result<RecoverMaterializationResponse, String> {
    let write_guard = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let mut connection = open_store(&root)?;
    schema::validate(&connection).map_err(|e| format!("schema validation failed: {e:?}"))?;
    let receipt = find_receipt(&connection, &request.operation_id).map_err(|e| format!("receipt lookup failed: {e:?}"))?
        .ok_or_else(|| "cannot recover materialization without a durable receipt".to_owned())?;
    let read_tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    let snapshot = read_ledger_snapshot(&read_tx).map_err(|e| format!("ledger snapshot failed: {e:?}"))?;
    read_tx.commit().map_err(|e| e.to_string())?;
    let mut job = find_job_by_generation(&connection, snapshot.generation)
        .map_err(|e| format!("current materialization job lookup failed: {e:?}"))?
        .ok_or_else(|| "current generation has no durable materialization job".to_owned())?;
    ensure_job_running(&mut connection, &job, request.recorded_at_utc_us)?;
    let result = (|| -> Result<super::materialize::MaterializationResult, String> {
        let ledger = project_ledger(&snapshot).map_err(|e| format!("current ledger projection failed: {e:?}"))?;
        let report = project_reports(&snapshot, &ledger).map_err(|e| format!("current report projection failed: {e:?}"))?;
        let staged = super::materialize::prepare_materialization(&root, &snapshot, &ledger, &report, snapshot.generation)?;
        super::materialize::publish_materialization(&root, &staged, &write_guard, snapshot.generation)
    })();
    let published = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = mark_materialization_failed(&mut connection, &job, &error, request.recorded_at_utc_us)?;
            return Err(format!("materialization remains recoverable: {error}"));
        }
    };
    update_job(&mut connection, &job.job_id, MaterializationStatus::Running, MaterializationStatus::Ready,
        Some(&published.manifest_sha256), None, None, request.recorded_at_utc_us)
        .map_err(|e| format!("recovery ready state write failed: {e:?}"))?;
    job = crate::finance_v2_store::commit::find_job(&connection, &job.job_id)
        .map_err(|e| format!("recovered job read failed: {e:?}"))?.ok_or_else(|| "recovered job missing".to_owned())?;

    let repo = DraftRepository::open(root);
    let draft_id = serde_json::from_str::<serde_json::Value>(&receipt.id_map_json).ok()
        .and_then(|v| v.get("draftId").and_then(serde_json::Value::as_str).map(str::to_owned))
        .and_then(|raw| Id::parse(raw).ok());
    let mut finalized = false;
    if let Some(draft_id) = draft_id {
        if let Some(marker) = repo.finalized_receipt(&draft_id).map_err(|e| format!("finalized marker read failed: {e:?}"))? {
            if marker.operation_id != receipt.operation_id || marker.receipt_id.as_str() != receipt.receipt_id.as_str() {
                return Err("draft finalization marker disagrees with the durable receipt".into());
            }
            finalized = true;
        } else {
            let durable_revision = persist_receipt_to_draft(&repo, &draft_id, &receipt)?;
            let proof = MaterializationReadyProof::verified(
                receipt.operation_id.clone(), receipt.receipt_id.clone(), receipt.generation, receipt.payload_sha256.clone(),
                job.generation, job.output_sha256.clone().ok_or_else(|| "ready repair job has no output hash".to_owned())?,
                published.generation, published.manifest_sha256.clone(),
            ).map_err(|e| format!("materialization finalization proof rejected: {e:?}"))?;
            repo.finalize_after_materialized(&draft_id, &proof, durable_revision)
                .map_err(|e| format!("workspace finalization cleanup remains recoverable: {e:?}"))?;
            finalized = true;
        }
    }
    Ok(RecoverMaterializationResponse { receipt, materialization_job: job, active_generation: published.generation,
        manifest_sha256: published.manifest_sha256, finalized })
}

#[tauri::command]
pub fn finance_v2_workspace_abandon(app:AppHandle,request:AbandonDraftRequest)->Result<(),String>{
    let _write=finance_v2_write_lock()?;
    let root=verify_session(&app,&request.session)?;
    let mut connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let repo=DraftRepository::open(root);
    let draft=repo.load(&request.draft_id).map_err(|e|format!("draft load failed: {e:?}"))?.ok_or_else(||"draft not found".to_owned())?;
    let receipt_check=match &draft.commit_state{
        DraftCommitState::Unprepared=>None,
        DraftCommitState::Prepared{operation_id,..}=>{
            if find_receipt(&connection,operation_id).map_err(|e|e.to_string())?.is_some(){return Err("a durable receipt exists; the draft cannot be abandoned".into())}
            Some(ReceiptNotFound::after_lookup(operation_id.clone(),true).map_err(|e|format!("abandon guard rejected: {e:?}"))?)
        },
        DraftCommitState::Committed{..}=>return Err("a committed draft cannot be abandoned".into()),
    };
    repo.abandon(&request.draft_id,receipt_check).map_err(|e|format!("draft abandonment failed: {e:?}"))
}
