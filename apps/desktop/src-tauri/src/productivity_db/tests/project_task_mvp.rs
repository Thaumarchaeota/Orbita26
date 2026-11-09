use crate::productivity_db::{commands::{add_task_sequence,create_project,create_project_expected,create_task_in_project,delete_task_subtree,remove_task_sequence,restore_task_subtree,restore_task_subtree_batch,set_task_card_position,move_task_same_level,move_task,create_action,commit_thing_lifecycle_mvp,set_task_status_guarded,list_deleted_task_batches},error::DomainError,types::*};
use super::harness::TestArchive;

fn project(root:&str)->ProjectSnapshot{create_project(root,CreateProjectRequest{title:"P".into(),description:None,status:"规划中".into(),planned_point:None,due_point:None}).unwrap().project}
fn create(root:&str,p:&ProjectSnapshot,parent:Option<&str>,title:&str,position:Option<TaskPositionInput>,edge:Option<TaskInitialSequence>)->ProjectSnapshot{
    create_task_in_project(root,CreateTaskInProjectRequest{item_type_id:None,classification_expected:None,expected_data_dir:root.into(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},title:title.into(),status:"未做".into(),parent_task_id:parent.map(str::to_string),description:None,planned_point:None,due_point:None,initial_position:position,new_initial_sequence:edge}).unwrap().project
}
fn err_code<T:std::fmt::Debug>(result:Result<T,DomainError>,code:&str){assert_eq!(result.unwrap_err().code,code);}

#[test]
fn sequence_creation_anchors_roundtrip_invalid_requests_do_not_write_and_omission_is_auto() {
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let p = project(&root);
    let p = create(&root, &p, None, "parent", None, None);
    let parent = p.tasks[0].id.clone();
    let p = create(&root, &p, Some(&parent), "source", None, None);
    let source = p.tasks.iter().find(|task| task.title == "source").unwrap().id.clone();
    let p = create(&root, &p, Some(&parent), "target", None, None);
    let target = p.tasks.iter().find(|task| task.title == "target").unwrap().id.clone();
    let base = TaskSequenceRequest {
        expected_data_dir: root.clone(), project: RevisionRef { id: p.id.clone(), expected_revision: p.revision },
        source_task_id: source.clone(), target_task_id: target.clone(),
        source_anchor: Some(TaskSequenceAnchor { side: "right".into(), offset: 0.25 }),
        target_anchor: Some(TaskSequenceAnchor { side: "left".into(), offset: 0.75 }),
    };
    for invalid in [
        TaskSequenceAnchor { side: "diagonal".into(), offset: 0.5 },
        TaskSequenceAnchor { side: "top".into(), offset: -0.1 },
        TaskSequenceAnchor { side: "bottom".into(), offset: 1.1 },
        TaskSequenceAnchor { side: "right".into(), offset: f64::NAN },
    ] {
        for source_endpoint in [true, false] {
            let mut request = base.clone();
            if source_endpoint { request.source_anchor = Some(invalid.clone()); }
            else { request.target_anchor = Some(invalid.clone()); }
            err_code(add_task_sequence(&root, request), "TASK_SEQUENCE_ANCHOR_INVALID");
        }
    }
    let unchanged = crate::productivity_db::read::get_project_cmd(&root, &p.id).unwrap().project;
    assert_eq!(unchanged.revision, p.revision);
    assert!(unchanged.task_sequence_edges.is_empty());
    let created = add_task_sequence(&root, base).unwrap().project;
    assert_eq!(created.revision, p.revision + 1);
    let edge = &created.task_sequence_edges[0];
    assert_eq!(edge.source_anchor.as_ref().map(|anchor| (anchor.side.as_str(), anchor.offset)), Some(("right", 0.25)));
    assert_eq!(edge.target_anchor.as_ref().map(|anchor| (anchor.side.as_str(), anchor.offset)), Some(("left", 0.75)));
    let reloaded = crate::productivity_db::read::get_project_cmd(&root, &p.id).unwrap().project;
    assert_eq!(serde_json::to_value(&reloaded.task_sequence_edges).unwrap(), serde_json::to_value(&created.task_sequence_edges).unwrap());
    let removed = remove_task_sequence(&root, RemoveTaskSequenceRequest {
        expected_data_dir: root.clone(), project: RevisionRef { id: created.id.clone(), expected_revision: created.revision }, edge_id: edge.id.clone(),
    }).unwrap().project;
    let omitted: TaskSequenceRequest = serde_json::from_value(serde_json::json!({
        "expectedDataDir": root, "project": { "id": removed.id, "expectedRevision": removed.revision },
        "sourceTaskId": source, "targetTaskId": target,
    })).unwrap();
    assert!(omitted.source_anchor.is_none() && omitted.target_anchor.is_none());
    let automatic = add_task_sequence(&root, omitted).unwrap().project;
    assert!(automatic.task_sequence_edges[0].source_anchor.is_none());
    assert!(automatic.task_sequence_edges[0].target_anchor.is_none());
    archive.cleanup();
}

#[test]
fn batch_card_positions_validate_atomically_and_bump_once_with_noop_preserved() {
    use crate::productivity_db::commands::set_task_card_positions;
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let p = project(&root);
    let p = create(&root, &p, None, "parent", None, None);
    let parent = p.tasks[0].id.clone();
    let p = create(&root, &p, Some(&parent), "A", Some(TaskPositionInput { x: 12.0, y: 24.0 }), None);
    let first = p.tasks.iter().find(|task| task.title == "A").unwrap().id.clone();
    let p = create(&root, &p, Some(&parent), "B", Some(TaskPositionInput { x: 48.0, y: 24.0 }), None);
    let second = p.tasks.iter().find(|task| task.title == "B").unwrap().id.clone();
    let p = add_task_sequence(&root, TaskSequenceRequest { source_anchor: None, target_anchor: None,
        expected_data_dir: root.clone(), project: RevisionRef { id: p.id.clone(), expected_revision: p.revision },
        source_task_id: first.clone(), target_task_id: second.clone(),
    }).unwrap().project;
    let input = |id: &str, x: f64, y: f64| TaskCardPositionInput { task_id: id.into(), x, y };
    let request = |snapshot: &ProjectSnapshot, positions| SetTaskCardPositionsRequest {
        expected_data_dir: root.clone(), project: RevisionRef { id: snapshot.id.clone(), expected_revision: snapshot.revision },
        expected_parent_task_id: Some(parent.clone()), positions,
    };
    let before = serde_json::to_value(&p).unwrap();
    // The first position is valid, but a later missing task must leave it untouched.
    err_code(set_task_card_positions(&root, request(&p, vec![input(&first, 100.0, 200.0), input("missing", 150.0, 200.0)])), "ROOT_NOT_FOUND");
    let unchanged = crate::productivity_db::read::get_project_cmd(&root, &p.id).unwrap().project;
    assert_eq!(serde_json::to_value(&unchanged).unwrap(), before);
    err_code(set_task_card_positions(&root, request(&p, vec![input(&first, 100.0, 200.0), input(&first, 150.0, 200.0)])), "TASK_COORDINATE_INVALID");
    err_code(set_task_card_positions(&root, request(&p, vec![input(&first, f64::INFINITY, 200.0)])), "TASK_COORDINATE_INVALID");
    let mut wrong_parent = request(&p, vec![input(&first, 100.0, 200.0)]);
    wrong_parent.expected_parent_task_id = None;
    err_code(set_task_card_positions(&root, wrong_parent), "TASK_PARENT_INVALID");
    let mut stale_root = request(&p, vec![input(&first, 100.0, 200.0)]);
    stale_root.expected_data_dir = format!("{root}-stale");
    err_code(set_task_card_positions(&root, stale_root), "ARCHIVE_LIFECYCLE_ERROR");
    let moved = set_task_card_positions(&root, request(&p, vec![input(&first, 100.0, 200.0), input(&second, 136.0, 200.0)])).unwrap().project;
    assert_eq!(moved.revision, p.revision + 1);
    for (id, x) in [(&first, 100.0), (&second, 136.0)] {
        let position = moved.task_card_positions.iter().find(|position| &position.task_id == id).unwrap();
        assert_eq!((position.x, position.y), (x, 200.0));
    }
    assert_eq!(serde_json::to_value(&moved.tasks).unwrap(), serde_json::to_value(&p.tasks).unwrap());
    assert_eq!(serde_json::to_value(&moved.task_sequence_edges).unwrap(), serde_json::to_value(&p.task_sequence_edges).unwrap());
    err_code(set_task_card_positions(&root, request(&p, vec![input(&first, 300.0, 400.0)])), "REVISION_CONFLICT");
    let noop = set_task_card_positions(&root, request(&moved, vec![input(&first, 100.0, 200.0), input(&second, 136.0, 200.0)])).unwrap().project;
    assert_eq!(serde_json::to_value(&noop).unwrap(), serde_json::to_value(&moved).unwrap());
    let empty = set_task_card_positions(&root, request(&noop, vec![])).unwrap().project;
    assert_eq!(empty.revision, noop.revision);
    archive.cleanup();
}

#[test]
fn project_create_rejects_stale_expected_data_dir_without_writing(){
    let a=TestArchive::new();let root=a.data_dir_str();let stale=format!("{root}-stale");
    err_code(create_project_expected(&root,CreateProjectRequest{title:"must not appear".into(),description:None,status:"规划中".into(),planned_point:None,due_point:None},Some(&stale)),"ARCHIVE_LIFECYCLE_ERROR");
    assert!(crate::productivity_db::read::list_projects_cmd(&root).unwrap().projects.is_empty());a.cleanup();
}

#[test]
fn sequence_edges_reject_duplicate_cycle_cross_level_and_nonfinite_positions(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);let p=create(&root,&p,None,"root",None,None);let parent=p.tasks[0].id.clone();let p=create(&root,&p,Some(&parent),"A",Some(TaskPositionInput{x:-24.0,y:0.0}),None);let first=p.tasks.iter().find(|t|t.title=="A").unwrap().id.clone();let p=create(&root,&p,Some(&parent),"B",None,None);let second=p.tasks.iter().find(|t|t.title=="B").unwrap().id.clone();
    let add=|p:&ProjectSnapshot,s:&str,t:&str|add_task_sequence(&root,TaskSequenceRequest{ source_anchor: None, target_anchor: None,expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},source_task_id:s.into(),target_task_id:t.into()});
    let p=add(&p,&first,&second).unwrap().project;err_code(add(&p,&first,&second),"TASK_SEQUENCE_DUPLICATE");err_code(add(&p,&second,&first),"TASK_SEQUENCE_CYCLE");
    let p=create(&root,&p,Some(&first),"third level",None,None);let third=p.tasks.iter().find(|t|t.title=="third level").unwrap().id.clone();err_code(add(&p,&first,&third),"TASK_SEQUENCE_ENDPOINT_INVALID");
    err_code(set_task_card_position(&root,SetTaskCardPositionRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:first.clone(),expected_parent_task_id:parent,x:f64::NAN,y:1.0}),"TASK_COORDINATE_INVALID");
    a.cleanup();
}

#[test]
fn initial_relation_and_position_commit_together_and_scope_is_restored_by_batch(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);let p=create(&root,&p,None,"root",None,None);let parent=p.tasks[0].id.clone();let p=create(&root,&p,Some(&parent),"anchor",Some(TaskPositionInput{x:12.0,y:24.0}),None);let anchor=p.tasks.iter().find(|t|t.title=="anchor").unwrap().id.clone();let p=create(&root,&p,Some(&parent),"temporary",None,None);let temporary=p.tasks.iter().find(|t|t.title=="temporary").unwrap().id.clone();let p=add_task_sequence(&root,TaskSequenceRequest{ source_anchor: None, target_anchor: None,expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},source_task_id:anchor.clone(),target_task_id:temporary.clone()}).unwrap().project;let old_edge=p.task_sequence_edges[0].id.clone();let p=remove_task_sequence(&root,RemoveTaskSequenceRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},edge_id:old_edge.clone()}).unwrap().project;
    let p=create(&root,&p,Some(&parent),"new",Some(TaskPositionInput{x:48.0,y:24.0}),Some(TaskInitialSequence{anchor_task_id:anchor.clone(),placement:"after".into()}));let new_id=p.tasks.iter().find(|t|t.title=="new").unwrap().id.clone();assert_eq!(p.task_sequence_edges.len(),1);assert_eq!(p.task_sequence_edges[0].source_task_id,anchor);
    let edge_id=p.task_sequence_edges[0].id.clone();let deleted=delete_task_subtree(&root,DeleteTaskSubtreeRequest{project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:new_id.clone(),expected_data_dir:Some(root.clone()),expected_subtree_task_ids:Some(vec![new_id.clone()]),expected_edge_ids:Some(vec![edge_id.clone()])}).unwrap().project;
    assert!(deleted.task_sequence_edges.is_empty());let batch_response=list_deleted_task_batches(&root,ListDeletedTaskBatchesRequest{expected_data_dir:root.clone(),project_id:p.id.clone()}).unwrap();let batch=batch_response.batches.iter().find(|batch|batch.root_task_id==new_id).unwrap();assert_eq!(batch.edge_ids,vec![edge_id.clone()]);assert!(!batch.edge_ids.contains(&old_edge));let restore=restore_task_subtree_batch(&root,RestoreTaskSubtreeBatchRequest{project:RevisionRef{id:batch_response.project_id.clone(),expected_revision:batch_response.project_revision},task_id:new_id.clone(),expected_data_dir:root.clone(),expected_deletion_batch_id:batch.deletion_batch_id.clone(),expected_subtree_task_ids:batch.task_ids.clone(),expected_edge_ids:batch.edge_ids.clone()}).unwrap();assert_eq!(restore.restore_summary.unwrap().restored_task_ids,vec![new_id]);assert_eq!(restore.project.task_sequence_edges.len(),1);assert!(!restore.project.task_sequence_edges.iter().any(|edge|edge.id==old_edge));a.cleanup();
}

#[test]
fn restore_requires_the_confirmed_batch_and_complete_task_scope(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);let p=create(&root,&p,None,"root",None,None);let parent=p.tasks[0].id.clone();
    let p=create(&root,&p,Some(&parent),"before",None,None);let before=p.tasks.iter().find(|t|t.title=="before").unwrap().id.clone();
    let p=create(&root,&p,Some(&parent),"to delete",None,None);let deleted_id=p.tasks.iter().find(|t|t.title=="to delete").unwrap().id.clone();
    let p=add_task_sequence(&root,TaskSequenceRequest{ source_anchor: None, target_anchor: None,expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},source_task_id:before,target_task_id:deleted_id.clone()}).unwrap().project;let edge_id=p.task_sequence_edges[0].id.clone();
    let first_delete=delete_task_subtree(&root,DeleteTaskSubtreeRequest{project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:deleted_id.clone(),expected_data_dir:Some(root.clone()),expected_subtree_task_ids:Some(vec![deleted_id.clone()]),expected_edge_ids:Some(vec![edge_id.clone()])}).unwrap().project;
    let first_list=list_deleted_task_batches(&root,ListDeletedTaskBatchesRequest{expected_data_dir:root.clone(),project_id:p.id.clone()}).unwrap();assert_eq!(first_list.project_revision,first_delete.revision);let batch_a=first_list.batches.iter().find(|batch|batch.root_task_id==deleted_id).unwrap().clone();
    let restored=restore_task_subtree_batch(&root,RestoreTaskSubtreeBatchRequest{project:RevisionRef{id:p.id.clone(),expected_revision:first_list.project_revision},task_id:deleted_id.clone(),expected_data_dir:root.clone(),expected_deletion_batch_id:batch_a.deletion_batch_id.clone(),expected_subtree_task_ids:batch_a.task_ids.clone(),expected_edge_ids:batch_a.edge_ids.clone()}).unwrap().project;
    let restored=create(&root,&restored,Some(&deleted_id),"new descendant",None,None);let descendant=restored.tasks.iter().find(|t|t.title=="new descendant").unwrap().id.clone();
    let second_delete=delete_task_subtree(&root,DeleteTaskSubtreeRequest{project:RevisionRef{id:restored.id.clone(),expected_revision:restored.revision},task_id:deleted_id.clone(),expected_data_dir:Some(root.clone()),expected_subtree_task_ids:Some(vec![deleted_id.clone(),descendant.clone()]),expected_edge_ids:Some(vec![edge_id.clone()])}).unwrap().project;
    let second_list=list_deleted_task_batches(&root,ListDeletedTaskBatchesRequest{expected_data_dir:root.clone(),project_id:p.id.clone()}).unwrap();let batch_b=second_list.batches.iter().find(|batch|batch.root_task_id==deleted_id).unwrap().clone();assert_ne!(batch_a.deletion_batch_id,batch_b.deletion_batch_id);
    err_code(restore_task_subtree_batch(&root,RestoreTaskSubtreeBatchRequest{project:RevisionRef{id:p.id.clone(),expected_revision:second_delete.revision},task_id:deleted_id.clone(),expected_data_dir:root.clone(),expected_deletion_batch_id:batch_a.deletion_batch_id,expected_subtree_task_ids:batch_a.task_ids,expected_edge_ids:batch_a.edge_ids}),"DELETE_BATCH_MISMATCH");
    err_code(restore_task_subtree_batch(&root,RestoreTaskSubtreeBatchRequest{project:RevisionRef{id:p.id.clone(),expected_revision:second_delete.revision},task_id:deleted_id.clone(),expected_data_dir:root.clone(),expected_deletion_batch_id:batch_b.deletion_batch_id.clone(),expected_subtree_task_ids:vec![deleted_id.clone()],expected_edge_ids:batch_b.edge_ids.clone()}),"TASK_RESTORE_SCOPE_MISMATCH");
    let after=list_deleted_task_batches(&root,ListDeletedTaskBatchesRequest{expected_data_dir:root.clone(),project_id:p.id.clone()}).unwrap();assert_eq!(after.project_revision,second_delete.revision);assert_eq!(after.batches.iter().find(|batch|batch.root_task_id==deleted_id).unwrap().deletion_batch_id,batch_b.deletion_batch_id);a.cleanup();
}

#[test]
fn same_level_move_with_edge_is_rejected_then_moves_complete_deep_subtree(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);let p=create(&root,&p,None,"r1",None,None);let r1=p.tasks[0].id.clone();let p=create(&root,&p,None,"r2",None,None);let r2=p.tasks.iter().find(|t|t.title=="r2").unwrap().id.clone();let p=create(&root,&p,Some(&r1),"moving",Some(TaskPositionInput{x:0.0,y:0.0}),None);let moving=p.tasks.iter().find(|t|t.title=="moving").unwrap().id.clone();let p=create(&root,&p,Some(&r1),"peer",None,None);let peer=p.tasks.iter().find(|t|t.title=="peer").unwrap().id.clone();let p=add_task_sequence(&root,TaskSequenceRequest{ source_anchor: None, target_anchor: None,expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},source_task_id:moving.clone(),target_task_id:peer}).unwrap().project;err_code(move_task_same_level(&root,MoveTaskSameLevelRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:moving.clone(),target_parent_task_id:r2.clone(),expected_source_sibling_ids:vec![moving.clone(),p.tasks.iter().find(|t|t.title=="peer").unwrap().id.clone()],expected_target_sibling_ids:vec![],target_ordered_sibling_ids:vec![moving.clone()],position:TaskPositionInput{x:10.0,y:10.0}}),"TASK_MOVE_HAS_SEQUENCE_EDGES");
    let p=remove_task_sequence(&root,RemoveTaskSequenceRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},edge_id:p.task_sequence_edges[0].id.clone()}).unwrap().project;
    let p=create(&root,&p,Some(&moving),"level3",None,None);let l3=p.tasks.iter().find(|t|t.title=="level3").unwrap().id.clone();let p=create(&root,&p,Some(&l3),"level4",None,None);let l4=p.tasks.iter().find(|t|t.title=="level4").unwrap().id.clone();
    let p=move_task_same_level(&root,MoveTaskSameLevelRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:moving.clone(),target_parent_task_id:r2.clone(),expected_source_sibling_ids:vec![moving.clone(),p.tasks.iter().find(|t|t.title=="peer").unwrap().id.clone()],expected_target_sibling_ids:vec![],target_ordered_sibling_ids:vec![moving.clone()],position:TaskPositionInput{x:10.0,y:10.0}}).unwrap().project;
    assert_eq!(p.tasks.iter().find(|t|t.id==l3).unwrap().parent_task_id.as_deref(),Some(moving.as_str()));assert_eq!(p.tasks.iter().find(|t|t.id==l4).unwrap().parent_task_id.as_deref(),Some(l3.as_str()));assert_eq!(p.tasks.iter().find(|t|t.id==moving).unwrap().parent_task_id.as_deref(),Some(r2.as_str()));a.cleanup();
}

#[test]
fn third_level_move_reorders_full_sibling_set_and_carries_five_level_subtree_without_card_position(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);
    let p=create(&root,&p,None,"root A",None,None);let root_a=p.tasks.iter().find(|t|t.title=="root A").unwrap().id.clone();
    let p=create(&root,&p,None,"root B",None,None);let root_b=p.tasks.iter().find(|t|t.title=="root B").unwrap().id.clone();
    let p=create(&root,&p,Some(&root_a),"parent A",Some(TaskPositionInput{x:1.0,y:2.0}),None);let parent_a=p.tasks.iter().find(|t|t.title=="parent A").unwrap().id.clone();
    let p=create(&root,&p,Some(&root_b),"parent B",Some(TaskPositionInput{x:3.0,y:4.0}),None);let parent_b=p.tasks.iter().find(|t|t.title=="parent B").unwrap().id.clone();
    let p=create(&root,&p,Some(&parent_a),"moving",None,None);let moving=p.tasks.iter().find(|t|t.title=="moving").unwrap().id.clone();
    let p=create(&root,&p,Some(&parent_a),"source peer",None,None);let source_peer=p.tasks.iter().find(|t|t.title=="source peer").unwrap().id.clone();
    let p=create(&root,&p,Some(&parent_b),"target peer",None,None);let target_peer=p.tasks.iter().find(|t|t.title=="target peer").unwrap().id.clone();
    let p=create(&root,&p,Some(&moving),"level 4",None,None);let l4=p.tasks.iter().find(|t|t.title=="level 4").unwrap().id.clone();
    let p=create(&root,&p,Some(&l4),"level 5",None,None);let l5=p.tasks.iter().find(|t|t.title=="level 5").unwrap().id.clone();
    let p=move_task_same_level(&root,MoveTaskSameLevelRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:moving.clone(),target_parent_task_id:parent_b.clone(),expected_source_sibling_ids:vec![moving.clone(),source_peer],expected_target_sibling_ids:vec![target_peer.clone()],target_ordered_sibling_ids:vec![moving.clone(),target_peer.clone()],position:TaskPositionInput{x:99.0,y:101.0}}).unwrap().project;
    assert_eq!(p.tasks.iter().find(|t|t.id==moving).unwrap().parent_task_id.as_deref(),Some(parent_b.as_str()));assert_eq!(p.tasks.iter().find(|t|t.id==l4).unwrap().parent_task_id.as_deref(),Some(moving.as_str()));assert_eq!(p.tasks.iter().find(|t|t.id==l5).unwrap().parent_task_id.as_deref(),Some(l4.as_str()));assert_eq!(p.tasks.iter().find(|t|t.id==target_peer).unwrap().sibling_position,1);assert!(!p.task_card_positions.iter().any(|position|position.task_id==moving));assert_eq!(p.task_card_positions.len(),2);a.cleanup();
}

#[test]
fn legacy_move_refuses_to_invalidate_live_card_position(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);
    let p=create(&root,&p,None,"root A",None,None);let root_a=p.tasks.iter().find(|t|t.title=="root A").unwrap().id.clone();
    let p=create(&root,&p,None,"root B",None,None);let root_b=p.tasks.iter().find(|t|t.title=="root B").unwrap().id.clone();
    let p=create(&root,&p,Some(&root_a),"positioned",Some(TaskPositionInput{x:7.0,y:9.0}),None);let positioned=p.tasks.iter().find(|t|t.title=="positioned").unwrap().id.clone();
    err_code(move_task(&root,MoveTaskRequest{project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},expected_data_dir:Some(root.clone()),task_id:positioned,parent_task_id:Some(root_b),insert_index:None,expected_siblings:vec![]}),"TASK_MOVE_HAS_CARD_POSITION");
    assert_eq!(crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project.task_card_positions.len(),1);a.cleanup();
}

#[test]
fn v21_archive_upgrade_adds_only_the_project_task_mvp_tables(){
    let a=TestArchive::new();let path=crate::productivity_db::coordinator::db_path(&a.data_dir_str());let conn=a.conn();conn.execute_batch("DROP TABLE productivity_task_card_position; DROP TABLE productivity_task_sequence_edge; DROP INDEX idx_task_item_type; ALTER TABLE productivity_task DROP COLUMN item_type_id; UPDATE archive_meta SET value='21' WHERE key='schema_version';").unwrap();crate::productivity_db::schema::ensure_schema(&conn,&path).unwrap();assert_eq!(crate::productivity_db::schema::read_schema_version(&conn).unwrap(),Some(crate::productivity_db::schema::CURRENT_SCHEMA_VERSION));let count:i64=conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('productivity_task_card_position','productivity_task_sequence_edge')",[],|r|r.get(0)).unwrap();assert_eq!(count,2);drop(conn);a.cleanup();
}

#[test]
fn manual_sequence_anchors_preserve_opposite_endpoint_and_survive_subtree_restore() {
    use crate::productivity_db::commands::set_task_sequence_anchor;
    let archive = TestArchive::new(); let root = archive.data_dir_str();
    let p = project(&root); let p = create(&root, &p, None, "parent", None, None);
    let parent = p.tasks[0].id.clone();
    let p = create(&root, &p, Some(&parent), "source", None, None);
    let source = p.tasks.iter().find(|t| t.title == "source").unwrap().id.clone();
    let p = create(&root, &p, Some(&parent), "target", None, None);
    let target = p.tasks.iter().find(|t| t.title == "target").unwrap().id.clone();
    let p = add_task_sequence(&root, TaskSequenceRequest { source_anchor: None, target_anchor: None, expected_data_dir:root.clone(), project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},source_task_id:source.clone(),target_task_id:target.clone() }).unwrap().project;
    let edge_id = p.task_sequence_edges[0].id.clone();
    assert!(p.task_sequence_edges[0].source_anchor.is_none());
    assert!(p.task_sequence_edges[0].target_anchor.is_none());
    let request = |p: &ProjectSnapshot, endpoint: &str, anchor: Option<TaskSequenceAnchor>| SetTaskSequenceAnchorRequest {
        expected_data_dir:root.clone(), project:RevisionRef{id:p.id.clone(),expected_revision:p.revision}, edge_id:edge_id.clone(),
        expected_source_task_id:source.clone(), expected_target_task_id:target.clone(), expected_parent_task_id:parent.clone(), endpoint:endpoint.into(), anchor,
    };
    for endpoint in ["source", "target"] {
        let same = set_task_sequence_anchor(&root, request(&p, endpoint, None)).unwrap().project;
        assert_eq!(same.revision, p.revision);
        assert_eq!(serde_json::to_value(&same).unwrap(), serde_json::to_value(&p).unwrap());
    }
    let stale = request(&p, "target", None);
    let p = set_task_sequence_anchor(&root, request(&p, "source", Some(TaskSequenceAnchor{side:"bottom".into(),offset:0.25}))).unwrap().project;
    err_code(set_task_sequence_anchor(&root, stale), "REVISION_CONFLICT");
    let p = set_task_sequence_anchor(&root, request(&p, "target", Some(TaskSequenceAnchor{side:"left".into(),offset:0.75}))).unwrap().project;
    assert_eq!(p.task_sequence_edges[0].source_anchor.as_ref().unwrap().offset, 0.25);
    assert_eq!(p.task_sequence_edges[0].source_task_id, source);
    assert_eq!(p.task_sequence_edges[0].target_task_id, target);
    for (endpoint, anchor) in [("source", p.task_sequence_edges[0].source_anchor.clone()), ("target", p.task_sequence_edges[0].target_anchor.clone())] {
        let same = set_task_sequence_anchor(&root, request(&p, endpoint, anchor)).unwrap().project;
        assert_eq!(same.revision, p.revision);
        assert_eq!(serde_json::to_value(&same).unwrap(), serde_json::to_value(&p).unwrap());
    }
    let mut wrong = request(&p, "source", None); wrong.expected_source_task_id = target.clone();
    err_code(set_task_sequence_anchor(&root, wrong), "TASK_SEQUENCE_ENDPOINT_INVALID");
    let mut wrong = request(&p, "source", None); wrong.expected_parent_task_id = source.clone();
    err_code(set_task_sequence_anchor(&root, wrong), "TASK_SEQUENCE_ENDPOINT_INVALID");
    let mut wrong = request(&p, "source", None); wrong.expected_data_dir = format!("{root}-stale");
    err_code(set_task_sequence_anchor(&root, wrong), "ARCHIVE_LIFECYCLE_ERROR");
    for (side, offset) in [("left", f64::NAN), ("top", f64::INFINITY), ("right", -0.01), ("bottom", 1.01), ("center", 0.5)] {
        err_code(set_task_sequence_anchor(&root, request(&p, "source", Some(TaskSequenceAnchor{side:side.into(),offset}))), "TASK_SEQUENCE_ANCHOR_INVALID");
    }
    err_code(set_task_sequence_anchor(&root, request(&p, "both", None)), "TASK_SEQUENCE_ANCHOR_INVALID");
    let p = delete_task_subtree(&root, DeleteTaskSubtreeRequest { project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:target.clone(),expected_data_dir:Some(root.clone()),expected_subtree_task_ids:Some(vec![target.clone()]),expected_edge_ids:Some(vec![edge_id.clone()]) }).unwrap().project;
    err_code(set_task_sequence_anchor(&root, request(&p, "source", None)), "ROOT_NOT_FOUND");
    let batches = list_deleted_task_batches(&root, ListDeletedTaskBatchesRequest { expected_data_dir:root.clone(),project_id:p.id.clone() }).unwrap();
    let batch = &batches.batches[0];
    let p = restore_task_subtree_batch(&root, RestoreTaskSubtreeBatchRequest { project:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:target.clone(),expected_data_dir:root.clone(),expected_deletion_batch_id:batch.deletion_batch_id.clone(),expected_subtree_task_ids:batch.task_ids.clone(),expected_edge_ids:batch.edge_ids.clone() }).unwrap().project;
    assert_eq!(p.task_sequence_edges[0].source_anchor.as_ref().unwrap().offset, 0.25);
    assert_eq!(p.task_sequence_edges[0].target_anchor.as_ref().unwrap().offset, 0.75);
    let p = set_task_sequence_anchor(&root, request(&p, "source", None)).unwrap().project;
    assert!(p.task_sequence_edges[0].source_anchor.is_none());
    assert_eq!(p.task_sequence_edges[0].target_anchor.as_ref().unwrap().offset, 0.75);
    let conn = archive.conn();
    conn.execute("UPDATE productivity_task_sequence_edge SET extra_json='{\"future\":true}' WHERE id=?1", [&edge_id]).unwrap();
    drop(conn);
    err_code(set_task_sequence_anchor(&root, request(&p, "target", None)), "UNKNOWN_FIELD_WRITE_BLOCKED");
    archive.cleanup();
}

#[test]
fn lifecycle_preserve_keeps_unstarted_actions_cancel_keeps_history_and_paused_action_blocks_status(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);let p=create(&root,&p,None,"complete",None,None);let task=p.tasks[0].clone();
    let action=create_action(&root,CreateActionRequest{ expected_data_dir: None,title:"reserved".into(),name_link_mode:None,summary:None,session_id:None,target_kind:Some("task".into()),target_id:Some(task.id.clone()),planned_start_at:None,planned_end_at:None,planned_duration:None,appearance:None}).unwrap().action;
    let result=commit_thing_lifecycle_mvp(&root,CommitThingLifecycleMvpRequest{thing_kind:"task".into(),owning_root:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:Some(task.id.clone()),outcome:"complete".into(),expected_members:vec![RevisionRef{id:action.id.clone(),expected_revision:action.revision}],confirm_active_intervals:false,expected_data_dir:root.clone(),expected_checkpoints:vec![],complete_checkpoints_without_actual:false,action_disposition:"preserve".into()}).unwrap();
    assert_eq!(result.project.unwrap().tasks.iter().find(|t|t.id==task.id).unwrap().status,"完成");let preserved=crate::productivity_db::read::get_action_cmd(&root,&action.id).unwrap().action;assert!(!preserved.ended);assert_eq!(preserved.revision,action.revision);
    let p=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;let cancel_task=create(&root,&p,None,"cancel",None,None).tasks.iter().find(|t|t.title=="cancel").unwrap().clone();let cancel_action=create_action(&root,CreateActionRequest{ expected_data_dir: None,title:"kept on cancel".into(),name_link_mode:None,summary:None,session_id:None,target_kind:Some("task".into()),target_id:Some(cancel_task.id.clone()),planned_start_at:None,planned_end_at:None,planned_duration:None,appearance:None}).unwrap().action;let p=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;
    let cancelled=commit_thing_lifecycle_mvp(&root,CommitThingLifecycleMvpRequest{thing_kind:"task".into(),owning_root:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:Some(cancel_task.id.clone()),outcome:"cancel".into(),expected_members:vec![RevisionRef{id:cancel_action.id.clone(),expected_revision:cancel_action.revision}],confirm_active_intervals:false,expected_data_dir:root.clone(),expected_checkpoints:vec![],complete_checkpoints_without_actual:false,action_disposition:"end".into()}).unwrap();assert_eq!(cancelled.actions.len(),0);assert!(crate::productivity_db::read::get_action_cmd(&root,&cancel_action.id).unwrap().action.deleted_at_utc.is_none());
    let fresh=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;let guarded_task=create(&root,&fresh,None,"guarded",None,None).tasks.iter().find(|t|t.title=="guarded").unwrap().clone();let active=create_action(&root,CreateActionRequest{ expected_data_dir: None,title:"paused".into(),name_link_mode:None,summary:None,session_id:None,target_kind:Some("task".into()),target_id:Some(guarded_task.id.clone()),planned_start_at:None,planned_end_at:None,planned_duration:None,appearance:None}).unwrap().action;
    let active=crate::productivity_db::commands::start_action(&root,StartActionRequest{ expected_data_dir: None,action:RevisionRef{id:active.id.clone(),expected_revision:active.revision}}).unwrap().action;let paused=crate::productivity_db::commands::pause_action(&root,PauseActionRequest{ expected_data_dir: None,action:RevisionRef{id:active.id.clone(),expected_revision:active.revision}}).unwrap().action;let current=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;
    err_code(set_task_status_guarded(&root,SetTaskStatusGuardedRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id.clone(),expected_revision:current.revision},task_id:guarded_task.id,status:"完成".into()}),"ACTIVE_ACTION_BLOCKS_THING");let _=paused;a.cleanup();
}

#[test]
fn checkpoint_on_descendant_does_not_expand_parent_completion_scope(){
    let a=TestArchive::new();let root=a.data_dir_str();let p=project(&root);let p=create(&root,&p,None,"parent",None,None);let parent=p.tasks[0].clone();let p=create(&root,&p,Some(&parent.id),"child",None,None);let child=p.tasks.iter().find(|t|t.title=="child").unwrap().clone();let cp=crate::productivity_db::checkpoint::create(&root,CreateCheckpointRequest{expected_data_dir:root.clone(),title:"child checkpoint".into(),description:None,appearance:None,planned_at_utc:None,target_kind:Some("task".into()),target_id:Some(child.id.clone()),owning_root:Some(RevisionRef{id:p.id.clone(),expected_revision:p.revision}),name_link_mode:None,session:None}).unwrap().checkpoint;
    let p=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;let completed=commit_thing_lifecycle_mvp(&root,CommitThingLifecycleMvpRequest{thing_kind:"task".into(),owning_root:RevisionRef{id:p.id.clone(),expected_revision:p.revision},task_id:Some(parent.id.clone()),outcome:"complete".into(),expected_members:vec![],confirm_active_intervals:false,expected_data_dir:root.clone(),expected_checkpoints:vec![],complete_checkpoints_without_actual:false,action_disposition:"preserve".into()}).unwrap();assert_eq!(completed.project.unwrap().tasks.iter().find(|t|t.id==parent.id).unwrap().status,"完成");assert!(!crate::productivity_db::checkpoint::get(&root,GetCheckpointRequest{id:cp.id,include_deleted:false}).unwrap().checkpoint.completed);
    let p=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;let made=create(&root,&p,None,"own cp",None,None);let own=made.tasks.iter().find(|t|t.title=="own cp").unwrap().clone();let p=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;let own_cp=crate::productivity_db::checkpoint::create(&root,CreateCheckpointRequest{expected_data_dir:root.clone(),title:"own checkpoint".into(),description:None,appearance:None,planned_at_utc:None,target_kind:Some("task".into()),target_id:Some(own.id.clone()),owning_root:Some(RevisionRef{id:p.id.clone(),expected_revision:p.revision}),name_link_mode:None,session:None}).unwrap().checkpoint;let p=crate::productivity_db::read::get_project_cmd(&root,&p.id).unwrap().project;err_code(set_task_status_guarded(&root,SetTaskStatusGuardedRequest{expected_data_dir:root.clone(),project:RevisionRef{id:p.id,expected_revision:p.revision},task_id:own.id,status:"完成".into()}),"TASK_PENDING_CHECKPOINT_BLOCKS_STATUS");assert!(!own_cp.completed);a.cleanup();
}


#[test]
fn task_type_selection_clear_inactive_and_tombstone_cleanup() {
    use crate::productivity_db::{classification::{create_item_type, delete_item_type, get_catalog, set_item_type_inactive}, commands::update_task};
    let archive = TestArchive::new();
    let root = archive.data_dir_str();
    let catalog = create_item_type(&root, CreateItemTypeRequest { catalog: None, name: "Task kind".into(), parent_item_type_id: None, color_override: Some("#123456".into()) }).unwrap().catalog.unwrap();
    let kind = catalog.item_types.iter().find(|n| n.name == "Task kind").unwrap().id.clone();
    let p = project(&root);
    let p = create_task_in_project(&root, CreateTaskInProjectRequest {
        expected_data_dir: root.clone(), project: RevisionRef { id:p.id.clone(), expected_revision:p.revision },
        title:"typed".into(), status:"未做".into(), parent_task_id:None, description:None,
        planned_point:None, due_point:None, initial_position:None, new_initial_sequence:None,
        item_type_id:Some(kind.clone()), classification_expected:Some(ClassificationExpected {
            item_type_catalog:Some(RevisionRef { id:catalog.id.clone(), expected_revision:catalog.revision }), tags:vec![],
        }),
    }).unwrap().project;
    let task_id = p.tasks[0].id.clone();
    assert_eq!(p.tasks[0].item_type_id.as_deref(), Some(kind.as_str()));
    let observed = get_catalog(&root).unwrap().catalog.unwrap();
    let node = observed.item_types.iter().find(|n| n.id == kind).unwrap();
    assert_eq!(node.reference_count, 1);
    let err = delete_item_type(&root, DeleteItemTypeRequest { expected_data_dir:root.clone(), catalog:RevisionRef { id:observed.id.clone(), expected_revision:observed.revision }, item_type_id:kind.clone() }).unwrap_err();
    assert_eq!(err.code, "CLASSIFICATION_REFERENCED");
    let inactive = set_item_type_inactive(&root, SetItemTypeInactiveRequest { catalog:RevisionRef { id:observed.id.clone(), expected_revision:observed.revision }, item_type_id:kind.clone(), inactive:true }).unwrap().catalog.unwrap();
    let patch = serde_json::from_value(serde_json::json!({"title":"retained"})).unwrap();
    let p = update_task(&root, UpdateTaskRequest { project:RevisionRef { id:p.id.clone(), expected_revision:p.revision }, expected_data_dir:Some(root.clone()), task_id:task_id.clone(), patch }).unwrap().project;
    assert_eq!(p.tasks[0].item_type_id.as_deref(), Some(kind.as_str()));
    let patch = serde_json::from_value(serde_json::json!({"itemTypeId":null})).unwrap();
    let p = update_task(&root, UpdateTaskRequest { project:RevisionRef { id:p.id.clone(), expected_revision:p.revision }, expected_data_dir:Some(root.clone()), task_id:task_id.clone(), patch }).unwrap().project;
    assert_eq!(p.tasks[0].item_type_id, None);
    let patch = serde_json::from_value(serde_json::json!({"itemTypeId":kind,"classificationExpected":{"itemTypeCatalog":{"id":inactive.id,"expectedRevision":inactive.revision}}})).unwrap();
    let err = update_task(&root, UpdateTaskRequest { project:RevisionRef { id:p.id.clone(), expected_revision:p.revision }, expected_data_dir:Some(root.clone()), task_id:task_id.clone(), patch }).unwrap_err();
    assert_eq!(err.code, "CLASSIFICATION_INACTIVE");
    let active = set_item_type_inactive(&root, SetItemTypeInactiveRequest { catalog:RevisionRef { id:inactive.id.clone(), expected_revision:inactive.revision }, item_type_id:kind.clone(), inactive:false }).unwrap().catalog.unwrap();
    let patch = serde_json::from_value(serde_json::json!({"itemTypeId":kind,"classificationExpected":{"itemTypeCatalog":{"id":active.id,"expectedRevision":active.revision}}})).unwrap();
    let p = update_task(&root, UpdateTaskRequest { project:RevisionRef { id:p.id.clone(), expected_revision:p.revision }, expected_data_dir:Some(root.clone()), task_id:task_id.clone(), patch }).unwrap().project;
    let deleted = delete_task_subtree(&root, DeleteTaskSubtreeRequest { project:RevisionRef { id:p.id.clone(), expected_revision:p.revision }, task_id:task_id.clone(), expected_data_dir:Some(root.clone()), expected_subtree_task_ids:Some(vec![task_id.clone()]), expected_edge_ids:Some(vec![]) }).unwrap().project;
    let latest = get_catalog(&root).unwrap().catalog.unwrap();
    delete_item_type(&root, DeleteItemTypeRequest { expected_data_dir:root.clone(), catalog:RevisionRef { id:latest.id, expected_revision:latest.revision }, item_type_id:kind }).unwrap();
    let conn = archive.conn();
    let (remaining, revision):(Option<String>,i64) = conn.query_row("SELECT t.item_type_id,p.revision FROM productivity_task t JOIN productivity_project p ON p.id=t.project_id WHERE t.id=?1", [&task_id], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(remaining, None);
    assert_eq!(revision, deleted.revision + 1);
    drop(conn);
    archive.cleanup();
}
