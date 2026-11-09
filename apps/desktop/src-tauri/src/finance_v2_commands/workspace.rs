use tauri::AppHandle;
use sha2::{Digest,Sha256};

use crate::{
    finance_v2_domain::Id,
    finance_v2_store::{accounts::read_account_via_snapshot, read::read_ledger_snapshot, schema, sources::{find_artifact, read_context_version}},
    finance_v2_workspace::{self, draft::{DraftRepository, DraftSnapshot}, AiCategorySuggestion},
};

use super::{
    session::{guarded_root_path, open_store, verify_session, FinanceV2Session},
    wire::{AiSuggestionsResponse, ApplyAiSuggestionsRequest, DraftReadRequest, ManualWorkspaceCreateRequest, WorkspaceCancelImportRequest, WorkspaceCreateRequest, WorkspaceKind, WorkspaceListRequest, WorkspaceListResponse, WorkspaceMutationResponse, WorkspaceResponse, WorkspaceRowAction, WorkspaceRowUpdateRequest, WorkspaceStageRefinementRequest, WorkspaceStageRequest, WorkspaceUndoRequest},
};

fn ledger_snapshot(app: &AppHandle, session: &FinanceV2Session) -> Result<(crate::finance_v2_workspace::IsolatedWorkspaceRoot, DraftRepository, crate::finance_v2_domain::LedgerSnapshot, Vec<crate::finance_v2_store::accounts::AccountViaBinding>, u64), String> {
    let root = verify_session(app, session)?;
    let connection = open_store(&root)?;
    schema::validate(&connection).map_err(|e| e.to_string())?;
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    let snapshot = read_ledger_snapshot(&tx).map_err(|e| e.to_string())?;
    let (mapping_revision, mapping) = read_account_via_snapshot(&tx).map_err(|e| e.to_string())?;
    drop(tx);
    let repo = DraftRepository::open(root.clone());
    Ok((root, repo, snapshot, mapping, mapping_revision))
}

fn require_mapping_snapshot(
    expected_revision: u64,
    captured: &[crate::finance_v2_workspace::CapturedAccountViaBinding],
    actual_revision: u64,
    actual: &[crate::finance_v2_store::accounts::AccountViaBinding],
) -> Result<(), String> {
    if expected_revision != actual_revision { return Err("Account/Via mapping revision changed; reload snapshot".into()); }
    let mut expected = captured.iter().map(|x| (x.account_id.clone(),x.via_id.clone(),x.revision,x.active)).collect::<Vec<_>>();
    let mut found = actual.iter().map(|x| (x.account_id.clone(),x.via_id.clone(),x.revision,x.active)).collect::<Vec<_>>();
    expected.sort(); found.sort();
    if expected != found { return Err("Account/Via mapping snapshot does not match current read transaction".into()); }
    Ok(())
}

#[tauri::command]
pub fn finance_v2_workspace_create(app: AppHandle, request: WorkspaceCreateRequest) -> Result<WorkspaceResponse, String> {
    let root=verify_session(&app,&request.session)?;
    let repo=DraftRepository::open(root.clone());
    let connection=open_store(&root)?;
    schema::validate(&connection).map_err(|e|e.to_string())?;
    let tx=connection.unchecked_transaction().map_err(|e|e.to_string())?;
    let base=read_ledger_snapshot(&tx).map_err(|e|e.to_string())?;
    let (actual_mapping_revision,mapping)=read_account_via_snapshot(&tx).map_err(|e|e.to_string())?;
    if base.generation != request.expected_ledger_generation { return Err("ledger generation changed; reload before creating a workspace".into()); }
    require_mapping_snapshot(request.account_via_mapping_revision,&request.captured_account_via_bindings,actual_mapping_revision,&mapping)?;
    let context=read_context_version(&tx,&request.source_context_id,request.source_context_revision).map_err(|e|format!("source context history read failed: {e:?}"))?.ok_or_else(||"source context version not found".to_owned())?;
    if !context.active { return Err("selected source context version is inactive".into()); }
    let selected_profile=request.observations.first().map(|o|(o.profile_id.as_str(),o.profile_revision.as_str())).ok_or_else(||"parse snapshot has no observations".to_owned())?;
    for observation in &request.observations {
        if observation.source_context_id!=request.source_context_id || observation.source_context_revision!=request.source_context_revision || observation.source_context_provider!=context.provider {
            return Err("parsed observation does not match selected source context provenance".into());
        }
        let artifact=find_artifact(&tx,&observation.artifact_id).map_err(|e|format!("source artifact lookup failed: {e:?}"))?.ok_or_else(||"source artifact not registered".to_owned())?;
        if artifact.sha256!=observation.artifact_sha256 || artifact.byte_length!=observation.artifact_byte_length || artifact.context_id!=request.source_context_id || artifact.context_revision!=request.source_context_revision || artifact.binding_revision!=observation.binding_revision || observation.profile_id!=selected_profile.0 || observation.profile_revision!=selected_profile.1 {
            return Err("parsed observation does not match immutable source artifact/profile provenance".into());
        }
        let artifact_path=guarded_root_path(&root,&artifact.relative_path)?;
        let metadata=std::fs::symlink_metadata(&artifact_path).map_err(|e|e.to_string())?;
        if metadata.file_type().is_symlink()||!metadata.is_file()||metadata.len()!=artifact.byte_length||metadata.len()>64*1024*1024{return Err("source artifact path or length failed isolated-root validation".into())}
        let bytes=std::fs::read(&artifact_path).map_err(|e|e.to_string())?;
        if format!("{:x}",Sha256::digest(&bytes))!=artifact.sha256{return Err("source artifact hash mismatch".into())}
    }
    drop(tx);
    let fixed = finance_v2_workspace::freeze_parse_snapshot(request.observations,request.confirmation,&request.source_context_id,request.source_context_revision,&base,actual_mapping_revision,request.captured_account_via_bindings).map_err(|e|format!("parse snapshot rejected: {e:?}"))?;
    let snapshot = DraftSnapshot::new(&root,fixed);
    let draft = repo.persist(&snapshot,0).map_err(|e|format!("draft persistence failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceResponse { workspace_kind:WorkspaceKind::Imported,draft_id:draft.draft_id.clone(),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model })
}

#[tauri::command]
pub fn finance_v2_workspace_create_manual(app:AppHandle,request:ManualWorkspaceCreateRequest)->Result<WorkspaceResponse,String>{
    let(root,repo,base,mapping,mapping_revision)=ledger_snapshot(&app,&request.session)?;
    if base.generation!=request.expected_ledger_generation{return Err("ledger generation changed; reload before creating manual workspace".into())}
    require_mapping_snapshot(request.account_via_mapping_revision,&request.captured_account_via_bindings,mapping_revision,&mapping)?;
    let fixed=crate::finance_v2_workspace::FixedParseSnapshot::manual_only(&base,mapping_revision,request.captured_account_via_bindings).map_err(|e|format!("manual workspace rejected: {e:?}"))?;
    let draft=DraftSnapshot::new_manual(&root,fixed).map_err(|e|format!("manual workspace creation failed: {e:?}"))?;
    let draft=repo.persist(&draft,0).map_err(|e|format!("draft persistence failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceResponse{workspace_kind:WorkspaceKind::ManualOnly,draft_id:draft.draft_id.clone(),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model})
}

#[tauri::command]
pub fn finance_v2_workspace_stage_refinement(app:AppHandle,request:WorkspaceStageRefinementRequest)->Result<WorkspaceMutationResponse,String>{
    let (_root,repo,base,mapping,mapping_revision)=ledger_snapshot(&app,&request.session)?;
    let mut draft=load_expected(&repo,&request.draft_id,request.expected_draft_revision)?;
    require_mapping_snapshot(draft.fixed_parse.account_via_mapping_revision,&draft.fixed_parse.captured_account_via_bindings,mapping_revision,&mapping)?;
    let expected_durable=draft.durable_revision;
    let input=request.input;
    let intent_id=finance_v2_workspace::stage_refinement_from_input(&mut draft,input,&base).map_err(|e|format!("refinement staging rejected: {e:?}"))?;
    let actual=draft.intents.iter().find(|intent|intent.intent_id==intent_id).ok_or_else(||"staged refinement disappeared".to_owned())?.source_item_ids.clone();
    let mut supplied=request.source_item_ids;
    supplied.sort();
    let mut derived=actual;
    derived.sort();
    if supplied!=derived{return Err("source item IDs do not match the occurrences derived by E3".into())}
    let draft=repo.persist(&draft,expected_durable).map_err(|e|format!("draft CAS failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceMutationResponse{workspace_kind:workspace_kind(&draft),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model})
}

#[tauri::command]
pub fn finance_v2_workspace_read(app: AppHandle, request: DraftReadRequest) -> Result<WorkspaceResponse, String> {
    let (_root,repo,base,_,_)=ledger_snapshot(&app,&request.session)?;
    let draft=repo.load(&request.draft_id).map_err(|e|format!("draft load failed: {e:?}"))?.ok_or_else(||"draft not found".to_owned())?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceResponse { workspace_kind:workspace_kind(&draft),draft_id:draft.draft_id.clone(),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model })
}

#[tauri::command]
pub fn finance_v2_workspace_list(app:AppHandle,request:WorkspaceListRequest)->Result<WorkspaceListResponse,String>{
    let root=verify_session(&app,&request.session)?;
    let repo=DraftRepository::open(root);
    let drafts=repo.list_drafts().map_err(|e|format!("workspace list failed: {e:?}"))?;
    Ok(WorkspaceListResponse{drafts})
}

#[tauri::command]
pub fn finance_v2_workspace_stage_intent(app: AppHandle, request: WorkspaceStageRequest) -> Result<WorkspaceMutationResponse, String> {
    let (_root,repo,base,mapping,mapping_revision)=ledger_snapshot(&app,&request.session)?;
    let mut draft=load_expected(&repo,&request.draft_id,request.expected_draft_revision)?;
    require_mapping_snapshot(draft.fixed_parse.account_via_mapping_revision,&draft.fixed_parse.captured_account_via_bindings,mapping_revision,&mapping)?;
    let expected_durable=draft.durable_revision;
    draft.stage_intent(request.payload,request.source_item_ids,&base).map_err(|e|format!("intent staging rejected: {e:?}"))?;
    let draft=repo.persist(&draft,expected_durable).map_err(|e|format!("draft CAS failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceMutationResponse { workspace_kind:workspace_kind(&draft),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model })
}

#[tauri::command]
pub fn finance_v2_workspace_undo(app: AppHandle, request: WorkspaceUndoRequest) -> Result<WorkspaceMutationResponse, String> {
    let (_root,repo,base,_,_)=ledger_snapshot(&app,&request.session)?;
    let mut draft=load_expected(&repo,&request.draft_id,request.expected_draft_revision)?;
    let expected_durable=draft.durable_revision;
    draft.undo_workspace_action(&request.operation_id).map_err(|e|format!("undo rejected: {e:?}"))?;
    let draft=repo.persist(&draft,expected_durable).map_err(|e|format!("draft CAS failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceMutationResponse { workspace_kind:workspace_kind(&draft),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model })
}

#[tauri::command]
pub fn finance_v2_workspace_apply_ai_suggestions(app: AppHandle, request: ApplyAiSuggestionsRequest) -> Result<AiSuggestionsResponse, String> {
    let (_root,repo,base,mapping,mapping_revision)=ledger_snapshot(&app,&request.session)?;
    let mut draft=load_expected(&repo,&request.draft_id,request.expected_draft_revision)?;
    require_mapping_snapshot(draft.fixed_parse.account_via_mapping_revision,&draft.fixed_parse.captured_account_via_bindings,mapping_revision,&mapping)?;
    let expected_durable=draft.durable_revision;
    let results=draft.apply_ai_category_suggestions(&request.suggestions,&base).map_err(|e|format!("AI category response rejected: {e:?}"))?;
    let draft=repo.persist(&draft,expected_durable).map_err(|e|format!("draft CAS failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(AiSuggestionsResponse { workspace_kind:workspace_kind(&draft),results,draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model })
}

#[tauri::command]
pub fn finance_v2_workspace_update_row(app:AppHandle,request:WorkspaceRowUpdateRequest)->Result<WorkspaceMutationResponse,String>{
    let (_root,repo,base,mapping,mapping_revision)=ledger_snapshot(&app,&request.session)?;
    let mut draft=load_expected(&repo,&request.draft_id,request.expected_draft_revision)?;
    require_mapping_snapshot(draft.fixed_parse.account_via_mapping_revision,&draft.fixed_parse.captured_account_via_bindings,mapping_revision,&mapping)?;
    let expected_durable=draft.durable_revision;
    match request.action {
        WorkspaceRowAction::SetCategory{category}=>draft.set_manual_category(&request.item_id,request.expected_item_revision,category,&base,request.changed_at_utc_micros).map_err(|e|format!("category edit rejected: {e:?}"))?,
        WorkspaceRowAction::Reject=>draft.reject_observation(&request.item_id,request.expected_item_revision).map_err(|e|format!("row rejection failed: {e:?}"))?,
        WorkspaceRowAction::Cancel=>draft.cancel_observation(&request.item_id,request.expected_item_revision).map_err(|e|format!("row cancellation failed: {e:?}"))?,
    }
    let draft=repo.persist(&draft,expected_durable).map_err(|e|format!("draft CAS failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceMutationResponse{workspace_kind:workspace_kind(&draft),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model})
}

#[tauri::command]
pub fn finance_v2_workspace_cancel_import(app:AppHandle,request:WorkspaceCancelImportRequest)->Result<WorkspaceMutationResponse,String>{
    let (_root,repo,base,_,_)=ledger_snapshot(&app,&request.session)?;
    let mut draft=load_expected(&repo,&request.draft_id,request.expected_draft_revision)?;
    let expected_durable=draft.durable_revision;
    draft.cancel_import().map_err(|e|format!("import cancellation failed: {e:?}"))?;
    let draft=repo.persist(&draft,expected_durable).map_err(|e|format!("draft CAS failed: {e:?}"))?;
    let read_model=finance_v2_workspace::read_workspace(&draft,&base);
    Ok(WorkspaceMutationResponse{workspace_kind:workspace_kind(&draft),draft_revision:draft.draft_revision,durable_revision:draft.durable_revision,read_model})
}

fn workspace_kind(draft:&DraftSnapshot)->WorkspaceKind{if draft.fixed_parse.observations.is_empty(){WorkspaceKind::ManualOnly}else{WorkspaceKind::Imported}}

fn load_expected(repo:&DraftRepository,id:&Id,expected_revision:u64)->Result<DraftSnapshot,String>{
    let draft=repo.load(id).map_err(|e|format!("draft load failed: {e:?}"))?.ok_or_else(||"draft not found".to_owned())?;
    if draft.draft_revision!=expected_revision || draft.durable_revision!=expected_revision { return Err("draft revision changed; reload before editing".into()); }
    Ok(draft)
}

#[allow(dead_code)] fn _ai_type(_: AiCategorySuggestion) {}
