use super::*;
use serde_json::json;
use crate::productivity_db::tests::harness::{TestArchive, assert_err_code};

fn fixture(root: &str) -> TripSnapshot {
    let id=new_uuid();
    super::super::commands::create(root,serde_json::from_value(json!({
        "requestId":new_uuid(),"expectedDataDir":root,"itemRef":null,"actionRefs":[],"checkpointRefs":[],
        "payload":{"newItemId":id,"title":"trip","listId":null,"firstContent":{
            "kind":"action","actionId":new_uuid(),"transportationId":new_uuid(),"startPointId":new_uuid(),"endPointId":new_uuid(),
            "plannedStartAt":"2026-10-31T10:00:00Z","plannedEndAt":"2026-10-31T11:00:00Z"}}
    })).unwrap()).unwrap().snapshot
}
fn edit(root: &str,s: &TripSnapshot,body: serde_json::Value,scope: Option<PlanHistoryScope>) -> TravelMutationEnvelope<EditPlanPayload> {
    TravelMutationEnvelope { request_id:new_uuid(),expected_data_dir:root.into(),item_ref:Some(crate::productivity_db::types::RevisionRef{id:s.item.id.clone(),expected_revision:s.item.revision}),
        action_refs:s.member_refs.actions.clone(),checkpoint_refs:s.member_refs.checkpoints.clone(),payload:EditPlanPayload{edit:body,resolutions:None,history_scope:scope} }
}
fn scope() -> PlanHistoryScope {PlanHistoryScope{owner_id:format!("host:epoch:destination:{}",new_uuid()),host_epoch:7}}
fn replay_request(root: &str,s: &TripSnapshot,scope: &PlanHistoryScope,token: &str,direction: &str) -> ReplayTravelPlanEffectRequest {
    ReplayTravelPlanEffectRequest {expected_data_dir:root.into(),history_owner_id:scope.owner_id.clone(),host_epoch:scope.host_epoch,request_id:new_uuid(),plan_history_token:token.into(),direction:direction.into(),
        current_trip_refs:PlanHistoryTripRefs{item:crate::productivity_db::types::RevisionRef{id:s.item.id.clone(),expected_revision:s.item.revision},actions:s.member_refs.actions.clone(),checkpoints:s.member_refs.checkpoints.clone()} }
}

#[test]
fn receipt_replay_is_idempotent_and_old_receipt_does_not_rewind_phase() {
    let archive=TestArchive::new();let root=archive.data_dir_str();let original=fixture(&root);let owner=scope();
    let request=edit(&root,&original,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),Some(owner.clone()));
    let edited=edit_plan(&root,request.clone()).unwrap();let token=edited.plan_history_token.clone().unwrap();
    let undo_req=replay_request(&root,&edited.snapshot,&owner,&token,"undo");
    let undone=replay(&root,undo_req.clone()).unwrap();
    assert_eq!(undone.snapshot.actions[0].planned_start_at,original.actions[0].planned_start_at);
    let duplicate=replay(&root,undo_req).unwrap();assert_eq!(duplicate.snapshot.item.revision,undone.snapshot.item.revision);
    let redone=replay(&root,replay_request(&root,&undone.snapshot,&owner,&token,"redo")).unwrap();
    assert_eq!(redone.plan_history.as_ref().unwrap().sequence,3);
    let late=super::super::receipt::get_receipt(&root,&root,&request.request_id).unwrap().result.unwrap();
    assert_eq!(late.plan_history.as_ref().unwrap().phase,"applied");
    assert_eq!(late.plan_history.as_ref().unwrap().sequence,1);
    assert_eq!(late.snapshot.item.revision,edited.snapshot.item.revision);
    assert_eq!(lock().unwrap().tokens[&token].sequence,3);
    archive.cleanup();
}

#[test]
fn split_replay_preserves_fixed_point_ids_and_detects_changed_managed_tombstone() {
    let archive=TestArchive::new();let root=archive.data_dir_str();let first=fixture(&root);let owner=scope();
    let second=super::super::commands::append(&root,serde_json::from_value(json!({
        "requestId":new_uuid(),"expectedDataDir":root,"itemRef":{"id":first.item.id,"expectedRevision":first.item.revision},
        "actionRefs":first.member_refs.actions,"checkpointRefs":first.member_refs.checkpoints,
        "payload":{"kind":"action","actionId":new_uuid(),"transportationId":new_uuid(),
            "plannedStartAt":"2026-10-31T11:00:00Z","plannedEndAt":"2026-10-31T12:00:00Z"}
    })).unwrap()).unwrap().snapshot;
    let request=edit(&root,&second,json!({"kind":"setSharedBoundary","frontActionId":second.actions[0].id,"rearActionId":second.actions[1].id,
        "zone":"frontEnd","plannedAtUtc":"2026-10-31T10:45:00Z","splitPolicies":{"movingFrontEnd":"front"}}),Some(owner.clone()));
    let edited=edit_plan(&root,request).unwrap();let token=edited.plan_history_token.as_ref().unwrap();
    let old_ids:BTreeSet<_>=second.points.iter().map(|p|p.id.clone()).collect();
    let new_ids:BTreeSet<_>=edited.snapshot.points.iter().map(|p|p.id.clone()).collect();
    let generated=new_ids.difference(&old_ids).next().unwrap().clone();
    let undone=replay(&root,replay_request(&root,&edited.snapshot,&owner,token,"undo")).unwrap();
    assert_eq!(undone.snapshot.points.iter().map(|p|p.id.clone()).collect::<BTreeSet<_>>(),old_ids);
    let redone=replay(&root,replay_request(&root,&undone.snapshot,&owner,token,"redo")).unwrap();
    assert_eq!(redone.snapshot.points.iter().map(|p|p.id.clone()).collect::<BTreeSet<_>>(),new_ids);
    let undone=replay(&root,replay_request(&root,&redone.snapshot,&owner,token,"undo")).unwrap();
    archive.conn().execute("UPDATE productivity_item_travel_point SET note='external tombstone edit' WHERE id=?1",[generated]).unwrap();
    assert_err_code(replay(&root,replay_request(&root,&undone.snapshot,&owner,token,"redo")).unwrap_err(),"restore_conflict");
    assert_eq!(lock().unwrap().tokens[token].applied,false);
    assert!(lock().unwrap().tokens[token].pending.is_none());
    archive.cleanup();
}

#[test]
fn owner_release_isolated_and_expired_receipt_does_not_recreate_token() {
    let archive=TestArchive::new();let root=archive.data_dir_str();let original=fixture(&root);let owner=scope();
    let request=edit(&root,&original,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),Some(owner.clone()));
    let edited=edit_plan(&root,request.clone()).unwrap();let token=edited.plan_history_token.as_ref().unwrap();
    let mut wrong=replay_request(&root,&edited.snapshot,&owner,token,"undo");wrong.history_owner_id="another destination".into();
    assert_err_code(replay(&root,wrong).unwrap_err(),"restore_conflict");
    release(ReleaseTravelPlanHistoryRequest{expected_data_dir:root.clone(),history_owner_id:"another destination".into(),host_epoch:owner.host_epoch,token_ids:None,all:true}).unwrap();
    assert!(lock().unwrap().tokens.contains_key(token));
    release(ReleaseTravelPlanHistoryRequest{expected_data_dir:root.clone(),history_owner_id:owner.owner_id.clone(),host_epoch:owner.host_epoch,token_ids:Some(vec![token.clone()]),all:false}).unwrap();
    let receipt=edit_plan(&root,request).unwrap();assert!(!receipt.plan_history.unwrap().available);
    assert!(!lock().unwrap().tokens.contains_key(token));
    archive.cleanup();
}

#[test]
fn no_op_and_legacy_caller_allocate_no_tokens_and_unknown_action_blocks_replay() {
    let archive=TestArchive::new();let root=archive.data_dir_str();let original=fixture(&root);let owner=scope();
    let noop=edit_plan(&root,edit(&root,&original,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":0}),Some(owner.clone()))).unwrap();
    assert!(!noop.changed);assert!(noop.plan_history_token.is_none());
    let legacy=edit_plan(&root,edit(&root,&original,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),None)).unwrap();
    assert!(legacy.plan_history_token.is_none());
    let edited=edit_plan(&root,edit(&root,&legacy.snapshot,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),Some(owner.clone()))).unwrap();
    archive.conn().execute("UPDATE productivity_action SET extra_json='{\"future\":true}' WHERE id=?1",[&original.actions[0].id]).unwrap();
    assert_err_code(replay(&root,replay_request(&root,&edited.snapshot,&owner,edited.plan_history_token.as_ref().unwrap(),"undo")).unwrap_err(),"UNKNOWN_FIELD_WRITE_BLOCKED");
    archive.cleanup();
}

#[test]
fn matching_receipt_finalizes_pending_once_and_mismatched_pending_stays_frozen() {
    let archive=TestArchive::new();let root=archive.data_dir_str();let original=fixture(&root);let owner=scope();
    let req=edit(&root,&original,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),Some(owner));
    let result=edit_plan(&root,req.clone()).unwrap();let id=result.plan_history_token.as_ref().unwrap();
    {let mut registry=lock().unwrap();let t=registry.tokens.get_mut(id).unwrap();t.applied=false;t.sequence=0;
     t.pending=Some(Pending{request:req.request_id.clone(),from:false,to:true,sequence:1,endpoint:t.after.clone()});}
    super::super::receipt::get_receipt(&root,&root,&req.request_id).unwrap();
    assert!(lock().unwrap().tokens[id].applied);assert_eq!(lock().unwrap().tokens[id].sequence,1);
    {let mut registry=lock().unwrap();let t=registry.tokens.get_mut(id).unwrap();t.pending=Some(Pending{request:"other-request".into(),from:true,to:false,sequence:2,endpoint:t.before.clone()});}
    let late=super::super::receipt::get_receipt(&root,&root,&req.request_id).unwrap().result.unwrap();
    assert!(!late.plan_history.unwrap().available);assert!(lock().unwrap().tokens[id].applied);
    archive.cleanup();
}

#[test]
fn time_only_effect_guards_all_live_point_topology_but_preserves_unrelated_text_and_tombstones() {
    let archive=TestArchive::new();let root=archive.data_dir_str();let original=fixture(&root);let owner=scope();
    let moved=edit_plan(&root,edit(&root,&original,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),Some(owner.clone()))).unwrap();
    let point=&original.points[0].id;
    archive.conn().execute("UPDATE productivity_item_travel_point SET note='new unrelated text' WHERE id=?1",[point]).unwrap();
    archive.conn().execute("INSERT INTO productivity_item_travel_point (id,item_id,schema_version,attachment_kind,action_id,role,created_at_utc,updated_at_utc,deleted_at_utc) SELECT ?1,item_id,schema_version,attachment_kind,action_id,role,created_at_utc,updated_at_utc,'2026-10-31T12:00:00Z' FROM productivity_item_travel_point WHERE id=?2",params![new_uuid(),point]).unwrap();
    let undone=replay(&root,replay_request(&root,&moved.snapshot,&owner,moved.plan_history_token.as_ref().unwrap(),"undo")).unwrap();
    assert_eq!(undone.snapshot.points.iter().find(|p|&p.id==point).unwrap().note.as_deref(),Some("new unrelated text"));
    let moved=edit_plan(&root,edit(&root,&undone.snapshot,json!({"kind":"moveGroup","actionIds":[original.actions[0].id],"deltaMinutes":30}),Some(owner.clone()))).unwrap();
    archive.conn().execute("UPDATE productivity_item_travel_point SET deleted_at_utc='2026-10-31T12:00:00Z' WHERE id=?1",[point]).unwrap();
    assert_err_code(replay(&root,replay_request(&root,&moved.snapshot,&owner,moved.plan_history_token.as_ref().unwrap(),"undo")).unwrap_err(),"restore_conflict");
    archive.cleanup();
}
