use serde_json::{json, Value};
use crate::productivity_db::{commands::*, types::*};
use super::harness::*;

const START: &str = "2026-01-01T08:00:00.000Z";
const END: &str = "2026-01-01T12:00:00.000Z";
const SHORT_END: &str = "2026-01-01T09:00:00.000Z";

fn reference(id: &str, revision: i64) -> Value { json!({"id":id,"expectedRevision":revision}) }
fn projection(action: &ActionSnapshot) -> Value {
    json!({"plannedStartAt":action.planned_start_at,"plannedEndAt":action.planned_end_at,
        "plannedDuration":action.planned_duration,"sessionId":action.session_id})
}
fn action_request(root: &str, action: &ActionSnapshot, item: &ItemSnapshot, target: Value) -> Value {
    json!({"expectedDataDir":root,"action":reference(&action.id,action.revision),
        "targetOwningRoot":reference(&item.id,item.revision),"expectedState":projection(action),"targetState":target,
        "currentSession":null,"currentSessionMembers":[],"nextSession":null,"nextSessionMembers":[]})
}
fn restore_action(root: &str, request: Value) -> crate::productivity_db::error::DomainResult<ActionResponse> {
    restore_action_arrangement_state(root, serde_json::from_value(request).unwrap())
}

#[test]
fn action_restore_cross_session_validates_both_memberships_and_execution() {
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let item = create_item(&root,"owner",None);
    let mut sessions = Vec::new();
    for (start,end) in [(START,SHORT_END),("2026-01-01T10:00:00.000Z",END)] {
        sessions.push(create_session(&root,CreateSessionRequest {title:"S".into(),description:None,
            planned_start_at:start.into(),planned_end_at:end.into(),track_lane:None,track_span:None}).unwrap().session);
    }
    let action = create_action(&root,CreateActionRequest { expected_data_dir:None,title:"move".into(),name_link_mode:None,
        summary:None,session_id:Some(sessions[0].id.clone()),target_kind:Some("item".into()),target_id:Some(item.id.clone()),
        planned_start_at:Some(START.into()),planned_end_at:Some(SHORT_END.into()),planned_duration:None,appearance:None }).unwrap().action;
    let mut request = action_request(&root,&action,&item,json!({"plannedStartAt":"2026-01-01T10:00:00.000Z",
        "plannedEndAt":"2026-01-01T11:00:00.000Z","plannedDuration":null,"sessionId":sessions[1].id}));
    request["currentSession"] = reference(&sessions[0].id,sessions[0].revision);
    request["currentSessionMembers"] = json!([reference(&action.id,action.revision)]);
    request["nextSession"] = reference(&sessions[1].id,sessions[1].revision);
    let mut missing = request.clone(); missing["currentSessionMembers"] = json!([]);
    assert_err_code(restore_action(&root,missing).unwrap_err(),"REVISION_CONFLICT");
    let moved = restore_action(&root,request).unwrap().action;
    assert_eq!(moved.session_id.as_deref(),Some(sessions[1].id.as_str()));
    let started = start_action(&root,StartActionRequest { expected_data_dir:Some(root.clone()),
        action:RevisionRef{id:moved.id.clone(),expected_revision:moved.revision} }).unwrap().action;
    let mut blocked = action_request(&root,&started,&item,projection(&action));
    blocked["currentSession"] = reference(&sessions[1].id,sessions[1].revision);
    blocked["currentSessionMembers"] = json!([reference(&started.id,started.revision)]);
    blocked["nextSession"] = reference(&sessions[0].id,sessions[0].revision);
    assert_err_code(restore_action(&root,blocked).unwrap_err(),"ACTION_EXECUTION_STATE_INVALID");
    assert_eq!(get_action(&root,&action.id).session_id,moved.session_id);
    archive.cleanup();
}

#[test]
fn nullable_projection_fields_are_required_and_restricted() {
    let base = json!({"plannedStartAt":null,"plannedEndAt":null,"plannedDuration":null,"sessionId":null});
    for field in ["plannedStartAt", "plannedEndAt", "plannedDuration", "sessionId"] {
        let mut missing = base.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<ActionArrangementState>(missing).is_err());
    }
    let mut extra = base;
    extra["title"] = json!("forbidden");
    assert!(serde_json::from_value::<ActionArrangementState>(extra).is_err());
}

#[test]
fn action_restore_preserves_duration_only_and_empty_plans_with_monotonic_revisions() {
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let item = create_item(&root, "target", None);
    let initial = create_action_for_item(&root, "preserved title", &item.id);
    let range = json!({"plannedStartAt":START,"plannedEndAt":SHORT_END,"plannedDuration":null,"sessionId":null});
    let duration = json!({"plannedStartAt":null,"plannedEndAt":null,"plannedDuration":1800,"sessionId":null});
    let first = restore_action(&root, action_request(&root,&initial,&item,duration.clone())).unwrap().action;
    let planned = restore_action(&root, action_request(&root,&first,&item,range.clone())).unwrap().action;
    let undone = restore_action(&root, action_request(&root,&planned,&item,duration.clone())).unwrap().action;
    assert_eq!(undone.planned_duration, Some(1800));
    assert!(undone.planned_start_at.is_none());
    assert_eq!(undone.revision, initial.revision+3);
    let empty = restore_action(&root, action_request(&root,&undone,&item,projection(&initial))).unwrap().action;
    let noop = restore_action(&root, action_request(&root,&empty,&item,projection(&empty))).unwrap().action;
    assert_eq!(noop.revision, empty.revision);
    assert_eq!(noop.updated_at_utc, empty.updated_at_utc);
    assert_eq!(noop.title, initial.title);
    let mut conflict = action_request(&root,&empty,&item,range);
    conflict["expectedState"] = duration;
    assert_err_code(restore_action(&root,conflict).unwrap_err(),"REVISION_CONFLICT");
    assert_eq!(get_action(&root,&initial.id).revision,empty.revision);
    archive.cleanup();
}

fn detached_fixture(root: &str) -> (SessionSnapshot, Vec<ActionSnapshot>, ItemSnapshot) {
    let item = create_item(root,"owner",None);
    let session = create_session(root,CreateSessionRequest { title:"session".into(),description:None,
        planned_start_at:START.into(),planned_end_at:END.into(),track_lane:None,track_span:None }).unwrap().session;
    let mut actions = Vec::new();
    for (start,end) in [("2026-01-01T10:00:00.000Z","2026-01-01T10:30:00.000Z"),
        ("2026-01-01T11:00:00.000Z","2026-01-01T11:30:00.000Z")] {
        actions.push(create_action(root,CreateActionRequest { expected_data_dir:None,title:"member".into(),name_link_mode:None,
            summary:None,session_id:Some(session.id.clone()),target_kind:Some("item".into()),target_id:Some(item.id.clone()),
            planned_start_at:Some(start.into()),planned_end_at:Some(end.into()),planned_duration:None,appearance:None }).unwrap().action);
    }
    let result = commit_session_boundary(root,CommitSessionBoundaryRequest { expected_data_dir:Some(root.into()),
        session:RevisionRef{id:session.id,expected_revision:session.revision},
        expected_members:actions.iter().map(|a| RevisionRef{id:a.id.clone(),expected_revision:a.revision}).collect(),
        expected_checkpoints:vec![],planned_start_at:START.into(),planned_end_at:SHORT_END.into() }).unwrap();
    (result.session,result.actions,item)
}
fn session_request(root: &str, session: &SessionSnapshot, actions: &[ActionSnapshot], item: &ItemSnapshot, attach: bool) -> Value {
    let refs: Vec<_> = actions.iter().map(|a| reference(&a.id,a.revision)).collect();
    let ids: Vec<_> = actions.iter().map(|a| a.id.clone()).collect();
    let changes: Vec<_> = actions.iter().map(|a| json!({"action":reference(&a.id,a.revision),
        "targetOwningRoot":reference(&item.id,item.revision),"expectedSessionId":a.session_id,
        "targetSessionId":if attach { Some(session.id.clone()) } else { None }})).collect();
    json!({"expectedDataDir":root,"session":reference(&session.id,session.revision),
        "expectedState":{"plannedStartAt":session.planned_start_at,"plannedEndAt":session.planned_end_at},
        "targetState":{"plannedStartAt":START,"plannedEndAt":if attach { END } else { SHORT_END }},
        "expectedMembers":if attach {vec![]} else {refs},"expectedCheckpoints":[],
        "targetMemberIds":if attach {ids} else {vec![]},"targetCheckpointIds":[],"membershipChanges":changes})
}
fn restore_session(root: &str, request: Value) -> crate::productivity_db::error::DomainResult<SessionAndActionsResponse> {
    restore_session_boundary_state(root,serde_json::from_value(request).unwrap())
}

#[test]
fn session_restore_multiple_detached_members_is_atomic_and_redo_uses_current_refs() {
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let (session,actions,item) = detached_fixture(&root);
    let request = session_request(&root,&session,&actions,&item,true);
    let mut stale = request.clone();
    stale["membershipChanges"][1]["action"]["expectedRevision"] = json!(0);
    assert_err_code(restore_session(&root,stale).unwrap_err(),"REVISION_CONFLICT");
    for a in &actions { assert!(get_action(&root,&a.id).session_id.is_none()); }
    let restored = restore_session(&root,request).unwrap();
    assert_eq!(restored.actions.len(),2);
    assert_eq!(restored.session.revision,session.revision+1);
    for a in &restored.actions { assert_eq!(a.session_id.as_deref(),Some(session.id.as_str())); }
    let redone = restore_session(&root,session_request(&root,&restored.session,&restored.actions,&item,false)).unwrap();
    assert_eq!(redone.session.planned_end_at,SHORT_END);
    for a in &redone.actions { assert!(a.session_id.is_none()); }
    archive.cleanup();
}

#[test]
fn session_restore_rolls_back_boundary_and_first_member_when_second_write_fails() {
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let (session,actions,item) = detached_fixture(&root);
    let conn = archive.conn();
    conn.execute_batch(&format!("CREATE TRIGGER restore_failure BEFORE UPDATE OF session_id ON productivity_action WHEN NEW.id='{}' BEGIN SELECT RAISE(ABORT,'injected failure'); END",actions[1].id)).unwrap();
    assert!(restore_session(&root,session_request(&root,&session,&actions,&item,true)).is_err());
    for a in &actions {
        let current = get_action(&root,&a.id);
        assert!(current.session_id.is_none());
        assert_eq!(current.revision,a.revision);
    }
    let revision: i64 = conn.query_row("SELECT revision FROM productivity_session WHERE id=?1",[&session.id],|r|r.get(0)).unwrap();
    let end: String = conn.query_row("SELECT planned_end_at FROM productivity_session WHERE id=?1",[&session.id],|r|r.get(0)).unwrap();
    assert_eq!(revision,session.revision);
    assert_eq!(end,SHORT_END);
    drop(conn);
    archive.cleanup();
}

#[test]
fn restore_rejects_wrong_path_and_unexpected_checkpoint_or_ownership_sets() {
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let (session,actions,item) = detached_fixture(&root);
    let original = session_request(&root,&session,&actions,&item,true);
    let mut wrong_path = original.clone(); wrong_path["expectedDataDir"] = json!("not-the-captured-root");
    assert!(restore_session(&root,wrong_path).is_err());
    let mut checkpoints = original.clone(); checkpoints["targetCheckpointIds"] = json!(["unknown"]);
    assert_err_code(restore_session(&root,checkpoints).unwrap_err(),"REVISION_CONFLICT");
    let mut stealing = original; stealing["membershipChanges"][0]["expectedSessionId"] = json!("other-session");
    assert_err_code(restore_session(&root,stealing).unwrap_err(),"INVALID_PATCH");
    for a in actions { assert!(get_action(&root,&a.id).session_id.is_none()); }
    archive.cleanup();
}
