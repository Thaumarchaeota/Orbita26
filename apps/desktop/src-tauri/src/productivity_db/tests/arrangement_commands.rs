use crate::productivity_db::{
    commands::{commit_action_arrangement, commit_session_boundary, commit_thing_lifecycle, create_action, create_session, end_action, start_action},
    read::get_business_time_zone_cmd,
    types::{
        ActionSnapshot, CommitActionArrangementRequest, CommitSessionBoundaryRequest,
        CommitThingLifecycleRequest, CreateActionRequest, CreateSessionRequest,
        EndActionRequest, RevisionRef, StartActionRequest,
    },
};
use rusqlite::params;

use super::harness::*;

fn session(data_dir: &str, title: &str, start: &str, end: &str) -> crate::productivity_db::types::SessionSnapshot {
    create_session(data_dir, CreateSessionRequest {
        title: title.into(), description: None, planned_start_at: start.into(), planned_end_at: end.into(),
        track_lane: None, track_span: None,
    }).expect("create session").session
}

fn action_in_session(data_dir: &str, item_id: &str, session_id: &str, title: &str, start: &str, end: &str) -> ActionSnapshot {
    create_action(data_dir, CreateActionRequest { expected_data_dir: None,
        title: title.into(), name_link_mode: Some("initial-linked".into()), summary: None,
        session_id: Some(session_id.into()), target_kind: Some("item".into()), target_id: Some(item_id.into()),
        planned_start_at: Some(start.into()), planned_end_at: Some(end.into()), planned_duration: None, appearance: None,
    }).expect("create session member action").action
}

fn refs(actions: &[ActionSnapshot]) -> Vec<RevisionRef> {
    actions.iter().map(|action| RevisionRef { id: action.id.clone(), expected_revision: action.revision }).collect()
}

fn arrangement_request(data_dir: &str, action: &ActionSnapshot, current: Option<&crate::productivity_db::types::SessionSnapshot>, current_members: &[ActionSnapshot], next: Option<&crate::productivity_db::types::SessionSnapshot>, next_members: &[ActionSnapshot], start: &str, end: &str) -> CommitActionArrangementRequest {
    CommitActionArrangementRequest { expected_data_dir: None,
        action: RevisionRef { id: action.id.clone(), expected_revision: action.revision },
        target_owning_root: action.target_id.as_ref().map(|id| {
            let item = get_item(data_dir, id);
            RevisionRef { id: item.id, expected_revision: item.revision }
        }),
        current_session: current.map(|s| RevisionRef { id: s.id.clone(), expected_revision: s.revision }),
        current_session_members: refs(current_members),
        next_session: next.map(|s| RevisionRef { id: s.id.clone(), expected_revision: s.revision }),
        next_session_members: refs(next_members),
        planned_start_at: start.into(), planned_end_at: end.into(),
    }
}

#[test]
fn action_arrangement_moves_between_sessions_atomically_with_exact_member_revisions() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let a = session(&data_dir, "A", "2026-01-01T08:00:00.000Z", "2026-01-01T10:00:00.000Z");
    let b = session(&data_dir, "B", "2026-01-01T10:00:00.000Z", "2026-01-01T12:00:00.000Z");
    let moving = action_in_session(&data_dir, &item.id, &a.id, "moving", "2026-01-01T08:30:00.000Z", "2026-01-01T09:00:00.000Z");
    let a_other = action_in_session(&data_dir, &item.id, &a.id, "other A", "2026-01-01T09:00:00.000Z", "2026-01-01T09:30:00.000Z");
    let b_other = action_in_session(&data_dir, &item.id, &b.id, "other B", "2026-01-01T10:30:00.000Z", "2026-01-01T11:00:00.000Z");

    let moved = commit_action_arrangement(&data_dir, arrangement_request(&data_dir,
        &moving, Some(&a), &[moving.clone(), a_other.clone()], Some(&b), &[b_other.clone()],
        "2026-01-01T11:00:00.000Z", "2026-01-01T11:30:00.000Z",
    )).expect("A to B arrangement").action;

    assert_eq!(moved.session_id.as_deref(), Some(b.id.as_str()));
    assert_eq!(moved.planned_start_at.as_deref(), Some("2026-01-01T11:00:00.000Z"));
    assert_eq!(moved.planned_end_at.as_deref(), Some("2026-01-01T11:30:00.000Z"));
    assert_eq!(moved.planned_duration, None);
    assert_eq!(moved.revision, moving.revision + 1);
    assert_eq!(get_action(&data_dir, &a_other.id).revision, a_other.revision);
    assert_eq!(get_action(&data_dir, &b_other.id).revision, b_other.revision);
    archive.cleanup();
}

#[test]
fn action_arrangement_rejects_missing_or_stale_member_without_partial_move() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let a = session(&data_dir, "A", "2026-01-01T08:00:00.000Z", "2026-01-01T10:00:00.000Z");
    let b = session(&data_dir, "B", "2026-01-01T10:00:00.000Z", "2026-01-01T12:00:00.000Z");
    let moving = action_in_session(&data_dir, &item.id, &a.id, "moving", "2026-01-01T08:30:00.000Z", "2026-01-01T09:00:00.000Z");
    let a_other = action_in_session(&data_dir, &item.id, &a.id, "other A", "2026-01-01T09:00:00.000Z", "2026-01-01T09:30:00.000Z");
    let b_other = action_in_session(&data_dir, &item.id, &b.id, "other B", "2026-01-01T10:30:00.000Z", "2026-01-01T11:00:00.000Z");
    let before = get_action(&data_dir, &moving.id);
    let facts = capture_facts(&archive, &data_dir);

    let missing = commit_action_arrangement(&data_dir, arrangement_request(&data_dir,
        &moving, Some(&a), &[moving.clone()], Some(&b), &[b_other.clone()],
        "2026-01-01T11:00:00.000Z", "2026-01-01T11:30:00.000Z",
    )).unwrap_err();
    assert_err_code(missing, "REVISION_CONFLICT");
    assert_eq!(get_action(&data_dir, &moving.id).session_id.as_deref(), Some(a.id.as_str()));

    let missing_target = commit_action_arrangement(&data_dir, arrangement_request(&data_dir,
        &moving, Some(&a), &[moving.clone(), a_other.clone()], Some(&b), &[],
        "2026-01-01T11:00:00.000Z", "2026-01-01T11:30:00.000Z",
    )).unwrap_err();
    assert_err_code(missing_target, "REVISION_CONFLICT");
    assert_eq!(get_action(&data_dir, &moving.id).session_id.as_deref(), Some(a.id.as_str()));

    crate::productivity_db::commands::update_action(&data_dir, crate::productivity_db::types::UpdateActionRequest { expected_data_dir: None,
        action: RevisionRef { id: b_other.id.clone(), expected_revision: b_other.revision },
        patch: crate::productivity_db::types::ActionPatch {
            title: Some("renamed B".into()), name_link_mode: None, summary: None,
            planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
        },
    }).expect("update target member");
    let stale_target_member = commit_action_arrangement(&data_dir, arrangement_request(&data_dir,
        &moving, Some(&a), &[moving.clone(), a_other.clone()], Some(&b), &[b_other.clone()],
        "2026-01-01T11:00:00.000Z", "2026-01-01T11:30:00.000Z",
    )).unwrap_err();
    assert_err_code(stale_target_member, "REVISION_CONFLICT");
    assert_eq!(get_action(&data_dir, &moving.id).session_id.as_deref(), Some(a.id.as_str()));

    // An Action revision can change without bumping the Session revision. The exact member
    // RevisionRef list must still catch it before moving the other member.
    crate::productivity_db::commands::update_action(&data_dir, crate::productivity_db::types::UpdateActionRequest { expected_data_dir: None,
        action: RevisionRef { id: a_other.id.clone(), expected_revision: a_other.revision },
        patch: crate::productivity_db::types::ActionPatch {
            title: Some("renamed".into()), name_link_mode: None, summary: None,
            planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
        },
    }).expect("update other action");
    let stale = commit_action_arrangement(&data_dir, arrangement_request(&data_dir,
        &moving, Some(&a), &[moving.clone(), a_other.clone()], Some(&b), &[b_other.clone()],
        "2026-01-01T11:00:00.000Z", "2026-01-01T11:30:00.000Z",
    )).unwrap_err();
    assert_err_code(stale, "REVISION_CONFLICT");
    assert_eq!(get_action(&data_dir, &moving.id).session_id.as_deref(), Some(a.id.as_str()));
    assert_eq!(get_action(&data_dir, &moving.id).planned_start_at, before.planned_start_at);
    assert_eq!(get_action(&data_dir, &b_other.id).session_id.as_deref(), Some(b.id.as_str()));
    assert_eq!(capture_facts(&archive, &data_dir).live_actions, facts.live_actions);
    archive.cleanup();
}

#[test]
fn action_arrangement_within_same_session_validates_both_exact_member_sets() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let s = session(&data_dir, "S", "2026-01-01T08:00:00.000Z", "2026-01-01T10:00:00.000Z");
    let moving = action_in_session(&data_dir, &item.id, &s.id, "moving", "2026-01-01T08:30:00.000Z", "2026-01-01T09:00:00.000Z");
    let other = action_in_session(&data_dir, &item.id, &s.id, "other", "2026-01-01T09:00:00.000Z", "2026-01-01T09:30:00.000Z");
    let updated = commit_action_arrangement(&data_dir, arrangement_request(&data_dir,
        &moving, Some(&s), &[moving.clone(), other.clone()], Some(&s), &[moving.clone(), other.clone()],
        "2026-01-01T08:45:00.000Z", "2026-01-01T09:15:00.000Z",
    )).expect("same Session reschedule").action;
    assert_eq!(updated.session_id.as_deref(), Some(s.id.as_str()));
    assert_eq!(updated.planned_start_at.as_deref(), Some("2026-01-01T08:45:00.000Z"));
    assert_eq!(updated.revision, moving.revision + 1);
    archive.cleanup();
}

#[test]
fn action_arrangement_checks_item_root_revision_and_archived_list_atomically() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let list = create_list(&data_dir, "list");
    let item = create_item(&data_dir, "target", Some(&list.id));
    let action = create_action_for_item(&data_dir, "work", &item.id);
    let req = arrangement_request(&data_dir, &action, None, &[], None, &[],
        "2026-01-01T08:00:00.000Z", "2026-01-01T09:00:00.000Z");

    let changed = crate::productivity_db::commands::set_item_status(&data_dir,
        crate::productivity_db::types::SetItemStatusRequest {
            item: RevisionRef { id: item.id.clone(), expected_revision: item.revision },
            status: "完成".into(),
        }).expect("update target item").item;
    assert_err_code(commit_action_arrangement(&data_dir, req.clone()).unwrap_err(), "REVISION_CONFLICT");
    assert_eq!(get_action(&data_dir, &action.id).revision, action.revision);

    let live_req = CommitActionArrangementRequest { expected_data_dir: None,
        target_owning_root: Some(RevisionRef { id: item.id.clone(), expected_revision: changed.revision }),
        ..req.clone()
    };
    assert_err_code(commit_action_arrangement(&data_dir, live_req.clone()).unwrap_err(), "INVALID_STATUS");
    assert_eq!(get_action(&data_dir, &action.id).revision, action.revision);
    assert_eq!(get_action(&data_dir, &action.id).planned_start_at, None);

    archive_list(&data_dir, &list);
    let archived_req = CommitActionArrangementRequest { expected_data_dir: None,
        action: RevisionRef { id: action.id.clone(), expected_revision: action.revision },
        ..live_req
    };
    assert_err_code(commit_action_arrangement(&data_dir, archived_req).unwrap_err(), "ARCHIVED_LIST_READONLY");
    assert_eq!(get_action(&data_dir, &action.id).revision, action.revision);
    archive.cleanup();
}

#[test]
fn action_arrangement_rejects_deleted_target_and_missing_target_expectation() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let action = create_action_for_item(&data_dir, "work", &item.id);
    let req = arrangement_request(&data_dir, &action, None, &[], None, &[],
        "2026-01-01T08:00:00.000Z", "2026-01-01T09:00:00.000Z");
    assert_err_code(commit_action_arrangement(&data_dir, CommitActionArrangementRequest { expected_data_dir: None,
        target_owning_root: None, ..req.clone()
    }).unwrap_err(), "INVALID_PATCH");
    crate::productivity_db::commands::delete_item(&data_dir,
        crate::productivity_db::types::DeleteItemRequest {
            item: RevisionRef { id: item.id, expected_revision: item.revision },
        }).expect("delete target");
    assert_err_code(commit_action_arrangement(&data_dir, req).unwrap_err(), "ROOT_DELETED");
    let saved = get_action(&data_dir, &action.id);
    assert_eq!(saved.revision, action.revision);
    assert_eq!(saved.planned_start_at, None);
    archive.cleanup();
}

#[test]
fn action_arrangement_checks_task_identity_and_project_root_revision() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let project = crate::productivity_db::commands::create_project(&data_dir,
        crate::productivity_db::types::CreateProjectRequest {
            title: "project".into(), description: None, status: "进行中".into(),
            planned_point: None, due_point: None,
        }).expect("create project").project;
    let with_task = crate::productivity_db::commands::create_task(&data_dir,
        crate::productivity_db::types::CreateTaskRequest { item_type_id: None, classification_expected: None,
            project: RevisionRef { id: project.id.clone(), expected_revision: project.revision },
            title: "task".into(), description: None, status: "未做".into(),
            parent_task_id: None, planned_point: None, due_point: None,
        }).expect("create task").project;
    let task_id = with_task.tasks[0].id.clone();
    let action = create_action(&data_dir, CreateActionRequest { expected_data_dir: None,
        title: "work".into(), name_link_mode: None, summary: None, session_id: None,
        target_kind: Some("task".into()), target_id: Some(task_id.clone()),
        planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
    }).expect("create task action").action;
    let base = CommitActionArrangementRequest { expected_data_dir: None,
        action: RevisionRef { id: action.id.clone(), expected_revision: action.revision },
        target_owning_root: Some(RevisionRef { id: with_task.id.clone(), expected_revision: with_task.revision }),
        current_session: None, current_session_members: vec![], next_session: None, next_session_members: vec![],
        planned_start_at: "2026-01-01T08:00:00.000Z".into(),
        planned_end_at: "2026-01-01T09:00:00.000Z".into(),
    };
    let wrong_root = CommitActionArrangementRequest { expected_data_dir: None,
        target_owning_root: Some(RevisionRef { id: "wrong-project".into(), expected_revision: with_task.revision }),
        ..base.clone()
    };
    assert_err_code(commit_action_arrangement(&data_dir, wrong_root).unwrap_err(), "ROOT_NOT_FOUND");
    let updated = crate::productivity_db::commands::set_task_status(&data_dir,
        crate::productivity_db::types::SetTaskStatusRequest {
            project: RevisionRef { id: with_task.id.clone(), expected_revision: with_task.revision },
            task_id, status: "完成".into(),
        }).expect("change task").project;
    assert_err_code(commit_action_arrangement(&data_dir, base.clone()).unwrap_err(), "REVISION_CONFLICT");
    assert_eq!(get_action(&data_dir, &action.id).revision, action.revision);
    let fresh = CommitActionArrangementRequest { expected_data_dir: None,
        target_owning_root: Some(RevisionRef { id: updated.id, expected_revision: updated.revision }),
        ..base
    };
    assert_err_code(commit_action_arrangement(&data_dir, fresh).unwrap_err(), "INVALID_STATUS");
    let saved = get_action(&data_dir, &action.id);
    assert_eq!(saved.revision, action.revision);
    assert_eq!(saved.planned_start_at, None);
    archive.cleanup();
}

#[test]
fn action_arrangement_keeps_archived_project_and_task_targets_read_only() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let project = crate::productivity_db::commands::create_project(&data_dir,
        crate::productivity_db::types::CreateProjectRequest {
            title: "project".into(), description: None, status: "进行中".into(),
            planned_point: None, due_point: None,
        }).expect("create project").project;
    let with_task = crate::productivity_db::commands::create_task(&data_dir,
        crate::productivity_db::types::CreateTaskRequest { item_type_id: None, classification_expected: None,
            project: RevisionRef { id: project.id.clone(), expected_revision: project.revision },
            title: "task".into(), description: None, status: "未做".into(),
            parent_task_id: None, planned_point: None, due_point: None,
        }).expect("create task").project;
    let project_action = create_action(&data_dir, CreateActionRequest { expected_data_dir: None,
        title: "project work".into(), name_link_mode: None, summary: None, session_id: None,
        target_kind: Some("project".into()), target_id: Some(project.id.clone()),
        planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
    }).expect("create project action").action;
    let task_action = create_action(&data_dir, CreateActionRequest { expected_data_dir: None,
        title: "task work".into(), name_link_mode: None, summary: None, session_id: None,
        target_kind: Some("task".into()), target_id: Some(with_task.tasks[0].id.clone()),
        planned_start_at: None, planned_end_at: None, planned_duration: None, appearance: None,
    }).expect("create task action").action;
    let archived = crate::productivity_db::commands::set_project_status(&data_dir,
        crate::productivity_db::types::SetProjectStatusRequest {
            project: RevisionRef { id: project.id.clone(), expected_revision: with_task.revision },
            status: "已归档".into(),
        }).expect("archive project").project;

    for action in [&project_action, &task_action] {
        let req = CommitActionArrangementRequest { expected_data_dir: None,
            action: RevisionRef { id: action.id.clone(), expected_revision: action.revision },
            target_owning_root: Some(RevisionRef { id: archived.id.clone(), expected_revision: archived.revision }),
            current_session: None, current_session_members: vec![], next_session: None, next_session_members: vec![],
            planned_start_at: "2026-01-01T08:00:00.000Z".into(),
            planned_end_at: "2026-01-01T09:00:00.000Z".into(),
        };
        assert_err_code(commit_action_arrangement(&data_dir, req).unwrap_err(), "INVALID_STATUS");
        let saved = get_action(&data_dir, &action.id);
        assert_eq!(saved.revision, action.revision);
        assert_eq!(saved.planned_start_at, None);
        assert_eq!(saved.session_id, None);
    }
    archive.cleanup();
}

#[test]
fn session_boundary_rejects_partial_member_cut_and_detaches_fully_excluded_member() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "target", None);
    let s = session(&data_dir, "S", "2026-01-01T09:00:00.000Z", "2026-01-01T11:00:00.000Z");
    let member = action_in_session(&data_dir, &item.id, &s.id, "member", "2026-01-01T09:30:00.000Z", "2026-01-01T10:30:00.000Z");
    let req = |start: &str, end: &str| CommitSessionBoundaryRequest {
        session: RevisionRef { id: s.id.clone(), expected_revision: s.revision },
        expected_members: refs(&[member.clone()]), expected_checkpoints: vec![], expected_data_dir: None, planned_start_at: start.into(), planned_end_at: end.into(),
    };
    let partial = commit_session_boundary(&data_dir, req("2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z")).unwrap_err();
    assert_err_code(partial, "ACTION_OUTSIDE_SESSION");
    assert_eq!(get_action(&data_dir, &member.id).session_id.as_deref(), Some(s.id.as_str()));
    assert_eq!(crate::productivity_db::read::get_session_cmd(&data_dir, &s.id).unwrap().session.revision, s.revision);

    let detached = commit_session_boundary(&data_dir, req("2026-01-01T10:30:00.000Z", "2026-01-01T12:30:00.000Z")).expect("detach fully excluded member");
    assert_eq!(detached.session.planned_start_at, "2026-01-01T10:30:00.000Z");
    assert_eq!(detached.actions.len(), 1);
    assert_eq!(detached.actions[0].session_id, None);
    assert_eq!(detached.actions[0].planned_start_at, member.planned_start_at);
    assert_eq!(detached.actions[0].revision, member.revision + 1);
    archive.cleanup();
}

#[test]
fn thing_lifecycle_requires_active_interval_confirmation_and_commits_cascade_atomically() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "complete me", None);
    let action = create_action_for_item(&data_dir, "active", &item.id);
    let active = start_action(&data_dir, StartActionRequest { expected_data_dir: None, action: RevisionRef { id: action.id.clone(), expected_revision: action.revision } }).unwrap().action;
    let req = |confirmed| CommitThingLifecycleRequest {
        thing_kind: "item".into(), owning_root: RevisionRef { id: item.id.clone(), expected_revision: item.revision },
        task_id: None, outcome: "complete".into(), expected_members: refs(&[active.clone()]), confirm_active_intervals: confirmed, expected_data_dir: None, expected_checkpoints: vec![], complete_checkpoints_without_actual: false,
    };
    let err = commit_thing_lifecycle(&data_dir, req(false)).unwrap_err();
    assert_err_code(err, "ACTION_EXECUTION_STATE_INVALID");
    let still_open: Option<String> = archive.conn().query_row("SELECT ended_at FROM productivity_interval WHERE action_id=?1", [&action.id], |r| r.get(0)).unwrap();
    assert_eq!(still_open, None);
    assert_eq!(get_item(&data_dir, &item.id).status, "进行中");

    let completed = commit_thing_lifecycle(&data_dir, req(true)).expect("complete and close interval");
    assert_eq!(completed.item.unwrap().status, "完成");
    assert!(completed.actions[0].ended);
    assert_eq!(completed.actions[0].deleted_at_utc, None);
    let closed: Option<String> = archive.conn().query_row("SELECT ended_at FROM productivity_interval WHERE action_id=?1", [&action.id], |r| r.get(0)).unwrap();
    assert!(closed.is_some());
    archive.cleanup();
}

#[test]
fn cancelling_thing_closes_and_tombstones_only_unended_actions_atomically() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let item = create_item(&data_dir, "cancel me", None);
    let active = create_action_for_item(&data_dir, "active", &item.id);
    let active = start_action(&data_dir, StartActionRequest { expected_data_dir: None,
        action: RevisionRef { id: active.id.clone(), expected_revision: active.revision },
    }).unwrap().action;
    let finished = create_action_for_item(&data_dir, "already ended", &item.id);
    let finished = end_action(&data_dir, EndActionRequest { expected_data_dir: None,
        action: RevisionRef { id: finished.id.clone(), expected_revision: finished.revision },
    }).unwrap().action;
    let result = commit_thing_lifecycle(&data_dir, CommitThingLifecycleRequest {
        thing_kind: "item".into(), owning_root: RevisionRef { id: item.id.clone(), expected_revision: item.revision },
        task_id: None, outcome: "cancel".into(), expected_members: refs(&[active.clone()]), confirm_active_intervals: true, expected_data_dir: None, expected_checkpoints: vec![], complete_checkpoints_without_actual: false,
    }).expect("cancel with interval confirmation");

    assert_eq!(result.item.unwrap().status, "取消");
    assert_eq!(result.actions.len(), 1);
    assert!(result.actions[0].deleted_at_utc.is_some());
    assert!(!result.actions[0].ended);
    let interval: (Option<String>, Option<String>) = archive.conn().query_row(
        "SELECT ended_at, deleted_at_utc FROM productivity_interval WHERE action_id=?1", [&active.id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();
    assert!(interval.0.is_some());
    assert!(interval.1.is_some());
    let finished_after = get_action(&data_dir, &finished.id);
    assert!(finished_after.ended);
    assert_eq!(finished_after.deleted_at_utc, None);
    archive.cleanup();
}

#[test]
fn business_timezone_read_returns_base_and_sorted_replacement_timeline() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    archive.conn().execute(
        "INSERT INTO timezone_replacement (id, start_utc, end_utc, offset) VALUES (?1, ?2, ?3, ?4), (?5, ?6, ?7, ?8)",
        params!["later", "2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z", "+10:00", "earlier", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "+09:00"],
    ).unwrap();
    let zone = get_business_time_zone_cmd(&data_dir).expect("read business timezone");
    assert_eq!(zone.base_offset, "+08:00");
    assert_eq!(zone.replacements.iter().map(|r| r.offset.as_str()).collect::<Vec<_>>(), vec!["+09:00", "+10:00"]);
    assert_eq!(zone.replacements[0].start_utc, "2026-01-01T00:00:00.000Z");
    archive.cleanup();
}
