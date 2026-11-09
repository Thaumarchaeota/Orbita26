use tauri::AppHandle;
use sha2::{Digest, Sha256};

use crate::{
    finance_v2_projection::{project_ledger, project_reports},
    finance_v2_store::{accounts::{read_account_via_snapshot, save_account, save_via, set_account_via}, calibrations::{append_calibration_version, read_calibration_history}, commit::{commit_once,find_job_by_generation,update_job,MaterializationJob,MaterializationStatus}, l0::read_deleted_current_facts, read::read_ledger_snapshot, schema, sources::{active_bindings,append_binding_version,append_context_version,list_contexts}},
};

use super::{session::{finance_v2_write_lock, open_store, verify_session, FinanceV2Session}, wire::{ManagementMutation, ManagementSaveRequest, ManagementSaveResponse, ReadSnapshotResponse, ReportsResponse, SourceBindingListRequest, SourceBindingListResponse}};

#[tauri::command]
pub fn finance_v2_read_snapshot(app: AppHandle, session: FinanceV2Session) -> Result<ReadSnapshotResponse, String> {
    let root = verify_session(&app, &session)?;
    let connection = open_store(&root)?;
    schema::validate(&connection).map_err(|e| e.to_string())?;
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    let snapshot = read_ledger_snapshot(&tx).map_err(|e| e.to_string())?;
    let restorable_facts=read_deleted_current_facts(&tx).map_err(|e|e.to_string())?;
    let (account_via_mapping_revision, account_via_bindings) = read_account_via_snapshot(&tx).map_err(|e| e.to_string())?;
    Ok(ReadSnapshotResponse { snapshot, restorable_facts, account_via_mapping_revision, account_via_bindings })
}

#[tauri::command]
pub fn finance_v2_project_reports(app: AppHandle, session: FinanceV2Session) -> Result<ReportsResponse, String> {
    let root = verify_session(&app, &session)?;
    let connection = open_store(&root)?;
    schema::validate(&connection).map_err(|e| e.to_string())?;
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    let snapshot = read_ledger_snapshot(&tx).map_err(|e| e.to_string())?;
    let ledger_projection = project_ledger(&snapshot).map_err(|e| format!("projection rejected snapshot: {e:?}"))?;
    let report_projection = project_reports(&snapshot, &ledger_projection).map_err(|e| format!("report projection rejected snapshot: {e:?}"))?;
    Ok(ReportsResponse { ledger_projection, report_projection })
}

#[tauri::command]
pub fn finance_v2_management_save(app:AppHandle,request:ManagementSaveRequest)->Result<ManagementSaveResponse,String>{
    let _write_guard=finance_v2_write_lock()?;
    let root=verify_session(&app,&request.session)?;
    let mut connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let payload=serde_json::to_vec(&request.mutation).map_err(|e|e.to_string())?;
    let payload_sha256=format!("{:x}",Sha256::digest(payload));
    let receipt_id=crate::finance_v2_domain::Id::new();
    let job_id=crate::finance_v2_domain::Id::new();
    let mutation=request.mutation;
    let result=commit_once(&mut connection,&request.operation_id,&receipt_id,&job_id,&payload_sha256,request.expected_generation,request.recorded_at_utc_us,move|tx|{
        let response=match mutation {
            ManagementMutation::Account{value,expected_revision}=>{
                save_account(tx,&value,expected_revision,request.recorded_at_utc_us)?;
                serde_json::to_value(value).map_err(|_|crate::finance_v2_store::StoreError::InvalidDomainValue)?
            }
            ManagementMutation::Via{value,expected_revision}=>{
                save_via(tx,&value,expected_revision,request.recorded_at_utc_us)?;
                serde_json::to_value(value).map_err(|_|crate::finance_v2_store::StoreError::InvalidDomainValue)?
            }
            ManagementMutation::SourceBinding{value,expected_revision}=>{
                let expected_alias=match value.profile_id.as_str(){
                    "wallet-csv-13/v1"|"wallet-xlsx-11/v1"|"boc-bank-pdf-text-12/v1"=>Some("via_hint"),
                    "credit-card-pdf-text-6/v1"=>Some("account_hint"),
                    "cmb-bank-pdf-text-6/v1"=>None,
                    _=>return Err(crate::finance_v2_store::StoreError::InvalidDomainValue),
                };
                let alias_allowed=matches!(value.field_alias.as_str(),"artifact_account"|"artifact_via") || expected_alias==Some(value.field_alias.as_str());
                let target_kind_allowed=match value.field_alias.as_str(){
                    "artifact_account"|"account_hint"=>value.account_id.is_some()&&value.via_id.is_none(),
                    "artifact_via"|"via_hint"=>value.account_id.is_none()&&value.via_id.is_some(),
                    _=>false,
                };
                if value.profile_revision!="1" || !alias_allowed || !target_kind_allowed{
                    return Err(crate::finance_v2_store::StoreError::InvalidDomainValue)
                }
                append_binding_version(tx,&value,expected_revision,request.recorded_at_utc_us)?;
                serde_json::to_value(value).map_err(|_|crate::finance_v2_store::StoreError::InvalidDomainValue)?
            }
            ManagementMutation::SourceContext{value,expected_revision}=>{
                append_context_version(tx,&value,expected_revision,request.recorded_at_utc_us)?;
                serde_json::to_value(value).map_err(|_|crate::finance_v2_store::StoreError::InvalidDomainValue)?
            }
            ManagementMutation::AccountVia{account_id,via_id,revision,active,expected_mapping_revision}=>{
                let (current_revision,_)=read_account_via_snapshot(tx)?;
                if current_revision!=expected_mapping_revision{return Err(crate::finance_v2_store::StoreError::StaleRevision)}
                set_account_via(tx,account_id.as_str(),via_id.as_str(),revision,active,request.recorded_at_utc_us)?;
                serde_json::json!({"accountId":account_id,"viaId":via_id,"revision":revision,"active":active})
            }
            ManagementMutation::Calibration{action,expected_revision}=>{
                use crate::finance_v2_domain::CalibrationStatus;
                let saved = match action {
                    super::wire::CalibrationAction::Save{point}=>{
                        if point.status!=CalibrationStatus::Active || point.recorded_at_utc_micros!=request.recorded_at_utc_us {
                            return Err(crate::finance_v2_store::StoreError::InvalidDomainValue)
                        }
                        append_calibration_version(tx,&point,expected_revision)?;
                        point
                    }
                    super::wire::CalibrationAction::Delete{id}=>{
                        let history=read_calibration_history(tx,&id)?;
                        let current=history.last().cloned().ok_or(crate::finance_v2_store::StoreError::InvalidDomainValue)?;
                        if current.status!=CalibrationStatus::Active || Some(current.revision)!=expected_revision {
                            return Err(crate::finance_v2_store::StoreError::StaleRevision)
                        }
                        let deleted=crate::finance_v2_domain::CalibrationPoint{revision:current.revision.checked_add(1).ok_or(crate::finance_v2_store::StoreError::InvalidDomainValue)?,status:CalibrationStatus::Deleted,recorded_at_utc_micros:request.recorded_at_utc_us,..current};
                        append_calibration_version(tx,&deleted,expected_revision)?;
                        deleted
                    }
                    super::wire::CalibrationAction::Restore{id,source_revision}=>{
                        let history=read_calibration_history(tx,&id)?;
                        let current=history.last().cloned().ok_or(crate::finance_v2_store::StoreError::InvalidDomainValue)?;
                        if current.status!=CalibrationStatus::Deleted || Some(current.revision)!=expected_revision {
                            return Err(crate::finance_v2_store::StoreError::StaleRevision)
                        }
                        let prior=history.into_iter().find(|point|point.revision==source_revision && point.status==CalibrationStatus::Active).ok_or(crate::finance_v2_store::StoreError::InvalidDomainValue)?;
                        let restored=crate::finance_v2_domain::CalibrationPoint{revision:current.revision.checked_add(1).ok_or(crate::finance_v2_store::StoreError::InvalidDomainValue)?,status:CalibrationStatus::Active,recorded_at_utc_micros:request.recorded_at_utc_us,..prior};
                        append_calibration_version(tx,&restored,expected_revision)?;
                        restored
                    }
                };
                serde_json::to_value(saved).map_err(|_|crate::finance_v2_store::StoreError::InvalidDomainValue)?
            }
        };
        Ok(response)
    }).map_err(|e|format!("management write rejected: {e:?}"))?;
    let entity=serde_json::from_str(&result.receipt.id_map_json).map_err(|e|format!("stored receipt payload is invalid: {e}"))?;
    let materialization = (|| -> Result<MaterializationJob,String> {
        let tx=connection.unchecked_transaction().map_err(|e|e.to_string())?;
        let snapshot=read_ledger_snapshot(&tx).map_err(|e|format!("management snapshot read failed: {e:?}"))?;
        tx.commit().map_err(|e|e.to_string())?;
        let ledger_projection=project_ledger(&snapshot).map_err(|e|format!("management projection failed: {e:?}"))?;
        let report_projection=project_reports(&snapshot,&ledger_projection).map_err(|e|format!("management report projection failed: {e:?}"))?;
        let mut job=find_job_by_generation(&connection,snapshot.generation).map_err(|e|format!("management job lookup failed: {e:?}"))?.ok_or_else(||"current generation has no materialization job".to_owned())?;
        if job.status!=MaterializationStatus::Running {
            update_job(&mut connection,&job.job_id,job.status,MaterializationStatus::Running,None,None,None,request.recorded_at_utc_us)
                .map_err(|e|format!("management materialization start failed: {e:?}"))?;
            job.status=MaterializationStatus::Running;
        }
        let staged=super::materialize::prepare_materialization(&root,&snapshot,&ledger_projection,&report_projection,snapshot.generation)?;
        let published=super::materialize::publish_materialization(&root,&staged,&_write_guard,snapshot.generation)?;
        update_job(&mut connection,&job.job_id,MaterializationStatus::Running,MaterializationStatus::Ready,Some(&published.manifest_sha256),None,None,request.recorded_at_utc_us)
            .map_err(|e|format!("management materialization ready state failed: {e:?}"))?;
        crate::finance_v2_store::commit::find_job_by_generation(&connection,snapshot.generation).map_err(|e|format!("management job read failed: {e:?}"))?.ok_or_else(||"materialization job disappeared".to_owned())
    })();
    let (materialization_job,materialization_error)=match materialization {
        Ok(job)=>(job,None),
        Err(error)=>{
            let current_generation=connection.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1",[],|row|row.get::<_,i64>(0))
                .ok().and_then(|value|u64::try_from(value).ok()).unwrap_or(result.receipt.generation);
            let current=find_job_by_generation(&connection,current_generation).ok().flatten().unwrap_or(result.job.clone());
            if current.status==MaterializationStatus::Running {
                let _=update_job(&mut connection,&current.job_id,MaterializationStatus::Running,MaterializationStatus::Failed,None,Some("materialization_failed"),Some(&error),request.recorded_at_utc_us);
            }
            let job=find_job_by_generation(&connection,current_generation).ok().flatten().unwrap_or(current);
            (job,Some(error))
        }
    };
    Ok(ManagementSaveResponse{entity,generation:result.receipt.generation,receipt:result.receipt,materialization_job,materialization_error})
}

#[tauri::command]
pub fn finance_v2_source_bindings(app:AppHandle,request:SourceBindingListRequest)->Result<SourceBindingListResponse,String>{
    let root=verify_session(&app,&request.session)?;
    let connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let tx=connection.unchecked_transaction().map_err(|e|e.to_string())?;
    let (global_revision,bindings)=active_bindings(&tx,&request.context_id,request.context_revision,&request.profile_id,&request.profile_revision).map_err(|e|format!("binding read failed: {e:?}"))?;
    Ok(SourceBindingListResponse{global_revision,bindings})
}

#[tauri::command]
pub fn finance_v2_source_contexts(app:AppHandle,session:crate::finance_v2_commands::session::FinanceV2Session)->Result<super::wire::SourceContextsResponse,String>{
    let root=super::session::verify_session(&app,&session)?;
    let connection=super::session::open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let tx=connection.unchecked_transaction().map_err(|e|e.to_string())?;
    let(global_revision,contexts)=list_contexts(&tx).map_err(|e|format!("source context read failed: {e:?}"))?;
    Ok(super::wire::SourceContextsResponse{global_revision,contexts})
}
