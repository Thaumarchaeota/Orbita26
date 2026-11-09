use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{finance_v2_domain::Id, finance_v2_store::{accounts, calibrations, evidence, l0, read, schema, sources}};
use super::session::{open_store, verify_session, FinanceV2Session};

#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct HistoryRequest { pub session:FinanceV2Session, pub entity_kind:String, pub entity_id:Id }

#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct HistoryResponse { pub entity_kind:String, pub entity_id:Id, pub entries:Vec<Value> }

#[tauri::command]
pub fn finance_v2_history(app:AppHandle,request:HistoryRequest)->Result<HistoryResponse,String>{
    let root=verify_session(&app,&request.session)?;
    let connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let tx=connection.unchecked_transaction().map_err(|e|e.to_string())?;
    let entries:Vec<Value>=match request.entity_kind.as_str(){
        "account"=>accounts::read_account_history(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|serde_json::to_value(v).map_err(|e|e.to_string())).collect::<Result<_,_>>()?,
        "via"=>accounts::read_via_history(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|serde_json::to_value(v).map_err(|e|e.to_string())).collect::<Result<_,_>>()?,
        "l0"=>l0::read_l0_history_entries(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|json!({"fact":v.fact,"changeOrigin":match v.change_origin{l0::L0ChangeOrigin::CreatedManual=>"created_manual",l0::L0ChangeOrigin::CreatedImported=>"created_imported",l0::L0ChangeOrigin::ManualAmend=>"manual_amend",l0::L0ChangeOrigin::Deleted=>"deleted",l0::L0ChangeOrigin::Restored=>"restored",l0::L0ChangeOrigin::Refined=>"refined"},"recordedAtUtcUs":v.recorded_at_utc_us})).collect(),
        "evidence_link"=>evidence::read_link_history(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|json!({"id":v.id,"revision":v.revision,"evidenceId":v.evidence_id,"observedAccountId":v.observed_account_id,"observationRole":v.observation_role,"relationKind":v.relation_kind,"groupingKind":v.grouping_kind,"groupId":v.group_id,"leafL0Id":v.leaf_l0_id,"leafL0Revision":v.leaf_l0_revision,"status":v.status,"allocationPayload":v.allocation_payload,"recordedAtUtcUs":v.recorded_at_utc_us})).collect(),
        "treatment"=>read::read_treatment_history_entries(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|json!({"treatment":v.treatment,"status":match v.status{crate::finance_v2_store::treatments::TreatmentStatus::Active=>"active",crate::finance_v2_store::treatments::TreatmentStatus::Deleted=>"deleted"},"recordedAtUtcUs":v.recorded_at_utc_us})).collect(),
        "calibration"=>calibrations::read_calibration_history(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|serde_json::to_value(v).map_err(|e|e.to_string())).collect::<Result<_,_>>()?,
        "source_context"=>sources::context_history(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|serde_json::to_value(v).map_err(|e|e.to_string())).collect::<Result<_,_>>()?,
        "source_binding"=>sources::binding_history(&tx,&request.entity_id).map_err(err)?.into_iter().map(|v|serde_json::to_value(v).map_err(|e|e.to_string())).collect::<Result<_,_>>()?,
        _=>return Err("unsupported history entity kind".into()),
    };
    Ok(HistoryResponse{entity_kind:request.entity_kind,entity_id:request.entity_id,entries})
}

fn err(value:impl std::fmt::Debug)->String{format!("history read failed: {value:?}")}
