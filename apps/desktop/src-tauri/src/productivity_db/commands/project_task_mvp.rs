use rusqlite::{params, OptionalExtension, Transaction};

use crate::productivity_db::coordinator::{in_transaction, with_write, with_write_expected};
use crate::productivity_db::error::{DomainError, DomainResult};
use crate::productivity_db::execution::action_started;
use crate::productivity_db::point::{point_to_json, validate_point};
use crate::productivity_db::repository::*;
use crate::productivity_db::types::*;
use crate::productivity_db::util::{new_uuid, utc_now};
use crate::productivity_db::validation::validate_task_status;

fn fail(code: &'static str, msg: &'static str) -> DomainError { DomainError::new(code, msg) }
fn project_guard(tx: &Transaction, project: &RevisionRef) -> DomainResult<Vec<TaskSnapshot>> {
    let (root, extra) = load_project_row(tx, &project.id, true)?;
    guard_unknown(&extra)?;
    check_revision(project.expected_revision, root.revision)?;
    let tasks = load_tasks_for_project(tx, &project.id, false)?;
    let _=project_snapshot(tx,&project.id,false)?;
    Ok(tasks)
}
fn live_edges(tx: &Transaction, project_id: &str) -> DomainResult<Vec<TaskSequenceEdgeSnapshot>> {
    let mut stmt = tx.prepare("SELECT * FROM productivity_task_sequence_edge WHERE project_id=?1 AND deleted_at_utc IS NULL ORDER BY id").map_err(sqlerr)?;
    let rows = stmt.query_map([project_id], |r| Ok((TaskSequenceEdgeSnapshot {
        id:r.get("id")?, project_id:r.get("project_id")?, source_task_id:r.get("source_task_id")?, target_task_id:r.get("target_task_id")?,
        source_anchor:task_sequence_anchor_from_row(r,"source_anchor_json")?, target_anchor:task_sequence_anchor_from_row(r,"target_anchor_json")?,
        created_at_utc:r.get("created_at_utc")?, updated_at_utc:r.get("updated_at_utc")?, deleted_at_utc:r.get("deleted_at_utc")?, deletion_batch_id:r.get("deletion_batch_id")?,
    }, r.get::<_,String>("extra_json")?))).map_err(sqlerr)?;
    let mut out=Vec::new(); for row in rows { let (e,x)=row.map_err(sqlerr)?; guard_unknown(&x)?; out.push(e); } Ok(out)
}
pub(crate) fn live_edges_for_move(tx:&Transaction,project_id:&str)->DomainResult<Vec<TaskSequenceEdgeSnapshot>>{live_edges(tx,project_id)}
fn sqlerr(e: rusqlite::Error) -> DomainError { DomainError::archive_lifecycle(e.to_string()) }
fn task<'a>(tasks: &'a [TaskSnapshot], id: &str) -> DomainResult<&'a TaskSnapshot> {
    tasks.iter().find(|t| t.id==id && t.deleted_at_utc.is_none()).ok_or_else(|| DomainError::root_not_found("task not found"))
}
fn second_level(tasks: &[TaskSnapshot], t: &TaskSnapshot) -> bool {
    t.parent_task_id.as_ref().and_then(|p| tasks.iter().find(|x| x.id==*p && x.deleted_at_utc.is_none())).is_some_and(|p| p.parent_task_id.is_none())
}
fn edge_graph_acyclic(edges: &[(String,String)]) -> bool {
    let mut adjacency: std::collections::HashMap<&str, Vec<&str>>=std::collections::HashMap::new();
    for (a,b) in edges { adjacency.entry(a).or_default().push(b); }
    fn visit<'a>(n:&'a str, g:&std::collections::HashMap<&'a str,Vec<&'a str>>, gray:&mut std::collections::HashSet<&'a str>, black:&mut std::collections::HashSet<&'a str>)->bool {
        if black.contains(n) { return true; } if !gray.insert(n) { return false; }
        if let Some(next)=g.get(n) { for m in next { if !visit(m,g,gray,black) { return false; } } }
        gray.remove(n); black.insert(n); true
    }
    let mut gray=std::collections::HashSet::new(); let mut black=std::collections::HashSet::new();
    adjacency.keys().all(|n| visit(n,&adjacency,&mut gray,&mut black))
}
fn bump(tx:&Transaction, project_id:&str, now:&str)->DomainResult<()> { bump_project(tx,project_id,now)?; Ok(()) }
fn response(tx:&Transaction, project_id:&str)->DomainResult<ProjectResponse> { Ok(ProjectResponse{project:project_snapshot(tx,project_id,true)?,restore_summary:None}) }
fn checked_root(expected:&str, actual:&str)->DomainResult<()> { if std::path::Path::new(expected)!=std::path::Path::new(actual) { Err(DomainError::archive_lifecycle("数据目录已切换，操作已取消")) } else { Ok(()) } }
fn ensure_no_started_task_actions(tx:&Transaction, task_ids:&[String])->DomainResult<()> {
    for task_id in task_ids {
        let mut stmt=tx.prepare("SELECT id FROM productivity_action WHERE target_kind='task' AND target_id=?1 AND deleted_at_utc IS NULL AND ended=0").map_err(sqlerr)?;
        let rows=stmt.query_map([task_id],|r|r.get::<_,String>(0)).map_err(sqlerr)?;
        for row in rows { let action_id=row.map_err(sqlerr)?; if action_started(&load_intervals(tx,&action_id,true)?){return Err(DomainError::active_action_blocks());} }
    }
    Ok(())
}

pub fn add_task_sequence(data_dir:&str, req:TaskSequenceRequest)->DomainResult<ProjectResponse> {
    checked_root(&req.expected_data_dir,data_dir)?;
    if req.source_anchor.as_ref().is_some_and(|anchor| !anchor.is_valid()) || req.target_anchor.as_ref().is_some_and(|anchor| !anchor.is_valid()) {
        return Err(fail("TASK_SEQUENCE_ANCHOR_INVALID", "端点必须指定有效边和 0 到 1 的有限相对位置"));
    }
    let source_anchor_json = req.source_anchor.as_ref().map(serde_json::to_string).transpose().map_err(|error| DomainError::archive_lifecycle(error.to_string()))?;
    let target_anchor_json = req.target_anchor.as_ref().map(serde_json::to_string).transpose().map_err(|error| DomainError::archive_lifecycle(error.to_string()))?;
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let tasks=project_guard(tx,&req.project)?; let a=task(&tasks,&req.source_task_id)?; let b=task(&tasks,&req.target_task_id)?;
        if req.source_task_id==req.target_task_id || !second_level(&tasks,a) || !second_level(&tasks,b) || a.parent_task_id!=b.parent_task_id { return Err(fail("TASK_SEQUENCE_ENDPOINT_INVALID","顺序关系两端必须属于同一父任务下的第二层")); }
        let mut edges=live_edges(tx,&req.project.id)?;
        if edges.iter().any(|e|e.source_task_id==req.source_task_id && e.target_task_id==req.target_task_id) { return Err(fail("TASK_SEQUENCE_DUPLICATE","顺序关系已存在")); }
        let mut proposed:Vec<_>=edges.iter().map(|e|(e.source_task_id.clone(),e.target_task_id.clone())).collect(); proposed.push((req.source_task_id.clone(),req.target_task_id.clone()));
        if !edge_graph_acyclic(&proposed) { return Err(fail("TASK_SEQUENCE_CYCLE","顺序关系会形成环")); }
        let now=utc_now(); tx.execute("INSERT INTO productivity_task_sequence_edge(id,project_id,source_task_id,target_task_id,source_anchor_json,target_anchor_json,created_at_utc,updated_at_utc) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",params![new_uuid(),req.project.id,req.source_task_id,req.target_task_id,source_anchor_json,target_anchor_json,now]).map_err(sqlerr)?;
        bump(tx,&req.project.id,&now)?; response(tx,&req.project.id)
    }))
}
pub fn remove_task_sequence(data_dir:&str,req:RemoveTaskSequenceRequest)->DomainResult<ProjectResponse>{
    checked_root(&req.expected_data_dir,data_dir)?;
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        project_guard(tx,&req.project)?; let edge=tx.query_row("SELECT extra_json FROM productivity_task_sequence_edge WHERE id=?1 AND project_id=?2 AND deleted_at_utc IS NULL",params![req.edge_id,req.project.id],|r|r.get::<_,String>(0)).optional().map_err(sqlerr)?.ok_or_else(||DomainError::root_not_found("sequence edge not found"))?; guard_unknown(&edge)?;
        let now=utc_now(); tx.execute("UPDATE productivity_task_sequence_edge SET deleted_at_utc=?1,updated_at_utc=?1 WHERE id=?2",params![now,req.edge_id]).map_err(sqlerr)?; bump(tx,&req.project.id,&now)?; response(tx,&req.project.id)
    }))
}
pub fn set_task_sequence_anchor(data_dir: &str, req: SetTaskSequenceAnchorRequest) -> DomainResult<ProjectResponse> {
    checked_root(&req.expected_data_dir, data_dir)?;
    if !matches!(req.endpoint.as_str(), "source" | "target") || req.anchor.as_ref().is_some_and(|a| !a.is_valid()) {
        return Err(fail("TASK_SEQUENCE_ANCHOR_INVALID", "端点必须指定有效边和 0 到 1 的有限相对位置"));
    }
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let tasks = project_guard(tx, &req.project)?;
        let edges = live_edges(tx, &req.project.id)?;
        let edge = edges.iter().find(|edge| edge.id == req.edge_id)
            .ok_or_else(|| DomainError::root_not_found("sequence edge not found"))?;
        if edge.source_task_id != req.expected_source_task_id || edge.target_task_id != req.expected_target_task_id {
            return Err(fail("TASK_SEQUENCE_ENDPOINT_INVALID", "顺序关系两端已变化"));
        }
        let source = task(&tasks, &edge.source_task_id)?;
        let target = task(&tasks, &edge.target_task_id)?;
        if source.id == target.id || !second_level(&tasks, source) || !second_level(&tasks, target)
            || source.parent_task_id.as_deref() != Some(req.expected_parent_task_id.as_str())
            || target.parent_task_id != source.parent_task_id {
            return Err(fail("TASK_SEQUENCE_ENDPOINT_INVALID", "顺序关系两端必须仍属于原父任务下的第二层"));
        }
        let current_anchor = if req.endpoint == "source" { &edge.source_anchor } else { &edge.target_anchor };
        let unchanged = match (current_anchor.as_ref(), req.anchor.as_ref()) {
            (None, None) => true,
            (Some(current), Some(requested)) => current.side == requested.side && current.offset == requested.offset,
            _ => false,
        };
        if unchanged { return response(tx, &req.project.id); }
        let anchor_json = req.anchor.as_ref().map(serde_json::to_string).transpose()
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        // Only a manual attachment choice changes; preserve relation identities,
        // the opposite endpoint and unknown-field write protection:
        // docs/specs/0012-project-task-mvp.proposed.md §9.
        let sql = if req.endpoint == "source" {
            "UPDATE productivity_task_sequence_edge SET source_anchor_json=?1,updated_at_utc=?2 WHERE id=?3 AND project_id=?4 AND deleted_at_utc IS NULL"
        } else {
            "UPDATE productivity_task_sequence_edge SET target_anchor_json=?1,updated_at_utc=?2 WHERE id=?3 AND project_id=?4 AND deleted_at_utc IS NULL"
        };
        let now = utc_now();
        tx.execute(sql, params![anchor_json, now, req.edge_id, req.project.id]).map_err(sqlerr)?;
        bump(tx, &req.project.id, &now)?;
        response(tx, &req.project.id)
    }))
}

pub fn set_task_card_position(data_dir:&str,req:SetTaskCardPositionRequest)->DomainResult<ProjectResponse>{
    checked_root(&req.expected_data_dir,data_dir)?;
    if !req.x.is_finite()||!req.y.is_finite(){return Err(fail("TASK_COORDINATE_INVALID","坐标必须是有限数值"));}
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let tasks=project_guard(tx,&req.project)?; let t=task(&tasks,&req.task_id)?;
        if !second_level(&tasks,t)||t.parent_task_id.as_deref()!=Some(req.expected_parent_task_id.as_str()){return Err(fail("TASK_PARENT_INVALID","任务父级已变化或不是第二层任务"));}
        let old:Option<(f64,f64,Option<String>,String)>=tx.query_row("SELECT x,y,deleted_at_utc,extra_json FROM productivity_task_card_position WHERE task_id=?1",[&req.task_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(sqlerr)?;
        if let Some((x,y,deleted,extra))=old{guard_unknown(&extra)?;if x==req.x&&y==req.y&&deleted.is_none(){return response(tx,&req.project.id);}}
        let now=utc_now(); tx.execute("INSERT INTO productivity_task_card_position(task_id,project_id,parent_task_id,x,y,updated_at_utc) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,parent_task_id=excluded.parent_task_id,x=excluded.x,y=excluded.y,updated_at_utc=excluded.updated_at_utc,deleted_at_utc=NULL",params![req.task_id,req.project.id,req.expected_parent_task_id,req.x,req.y,now]).map_err(sqlerr)?;
        bump(tx,&req.project.id,&now)?; response(tx,&req.project.id)
    }))
}

pub fn set_task_card_positions(data_dir: &str, req: SetTaskCardPositionsRequest) -> DomainResult<ProjectResponse> {
    // One captured Project revision commits the complete group together (docs/adr/0046-project-path-map.md).
    checked_root(&req.expected_data_dir, data_dir)?;
    let mut ids = std::collections::HashSet::new();
    for position in &req.positions {
        if !position.x.is_finite() || !position.y.is_finite() || !ids.insert(position.task_id.as_str()) {
            return Err(fail("TASK_COORDINATE_INVALID", "任务坐标必须有限且任务不能重复"));
        }
    }
    with_write_expected(&req.expected_data_dir, |conn| in_transaction(conn, |tx| {
        let tasks = project_guard(tx, &req.project)?;
        let mut changed = Vec::new();
        // Validate the entire selection before touching any stored position.
        for position in &req.positions {
            let current_task = task(&tasks, &position.task_id)?;
            if !second_level(&tasks, current_task) || current_task.parent_task_id != req.expected_parent_task_id {
                return Err(fail("TASK_PARENT_INVALID", "任务父级已变化或不是第二层任务"));
            }
            let old: Option<(f64, f64, Option<String>, String)> = tx.query_row(
                "SELECT x,y,deleted_at_utc,extra_json FROM productivity_task_card_position WHERE task_id=?1",
                [&position.task_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            ).optional().map_err(sqlerr)?;
            let unchanged = if let Some((x, y, deleted, extra)) = old {
                guard_unknown(&extra)?;
                x == position.x && y == position.y && deleted.is_none()
            } else { false };
            if !unchanged { changed.push(position); }
        }
        if changed.is_empty() { return response(tx, &req.project.id); }
        let now = utc_now();
        for position in changed {
            tx.execute(
                "INSERT INTO productivity_task_card_position(task_id,project_id,parent_task_id,x,y,updated_at_utc) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,parent_task_id=excluded.parent_task_id,x=excluded.x,y=excluded.y,updated_at_utc=excluded.updated_at_utc,deleted_at_utc=NULL",
                params![position.task_id, req.project.id, req.expected_parent_task_id, position.x, position.y, now],
            ).map_err(sqlerr)?;
        }
        bump(tx, &req.project.id, &now)?;
        response(tx, &req.project.id)
    }))
}

pub fn reorder_task_siblings(data_dir:&str,req:ReorderTaskSiblingsRequest)->DomainResult<ProjectResponse>{
    checked_root(&req.expected_data_dir,data_dir)?;
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let tasks=project_guard(tx,&req.project)?;
        if let Some(p)=&req.parent_task_id { task(&tasks,p)?; }
        let mut current:Vec<String>=tasks.iter().filter(|t|t.deleted_at_utc.is_none()&&t.parent_task_id==req.parent_task_id).map(|t|t.id.clone()).collect(); current.sort_by_key(|id|tasks.iter().find(|t|t.id==*id).unwrap().sibling_position);
        let mut expected=req.expected_sibling_ids.clone();let mut actual=current.clone();expected.sort();actual.sort();let mut ordered=req.ordered_sibling_ids.clone();let mut unique=ordered.clone();unique.sort();unique.dedup();
        if expected!=actual||ordered.len()!=current.len()||unique.len()!=ordered.len()||ordered.iter().cloned().collect::<std::collections::HashSet<_>>()!=current.iter().cloned().collect(){return Err(fail("TASK_SIBLING_SET_MISMATCH","兄弟任务集合已变化，排序未应用"));}
        if current==ordered{return response(tx,&req.project.id)} let now=utc_now(); for (i,id) in ordered.iter().enumerate(){tx.execute("UPDATE productivity_task SET sibling_position=?1,updated_at_utc=?2 WHERE id=?3",params![i as i64,now,id]).map_err(sqlerr)?;} bump(tx,&req.project.id,&now)?; response(tx,&req.project.id)
    }))
}

pub fn move_task_same_level(data_dir:&str,req:MoveTaskSameLevelRequest)->DomainResult<ProjectResponse>{
    checked_root(&req.expected_data_dir,data_dir)?; if !req.position.x.is_finite()||!req.position.y.is_finite(){return Err(fail("TASK_COORDINATE_INVALID","坐标必须是有限数值"));}
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let tasks=project_guard(tx,&req.project)?;let moving=task(&tasks,&req.task_id)?;let target_parent=task(&tasks,&req.target_parent_task_id)?;
        let depth_of=|id:&str|->Option<usize>{let mut depth=0usize;let mut current=Some(id);while let Some(id)=current{depth+=1;current=tasks.iter().find(|t|t.id==id)?.parent_task_id.as_deref();if depth>tasks.len(){return None;}}Some(depth)};
        let moving_depth=depth_of(&moving.id).ok_or_else(||DomainError::tree_cycle())?;
        let target_depth=depth_of(&target_parent.id).ok_or_else(||DomainError::tree_cycle())?;
        if moving_depth<2||target_depth+1!=moving_depth{return Err(fail("TASK_PARENT_INVALID","目标必须是同一层级下的父任务"));}
        if moving.parent_task_id.as_deref()==Some(req.target_parent_task_id.as_str()){return Err(DomainError::invalid_patch("目标父级与当前相同"));}
        let descendants=task_descendants(tx,&req.project.id,&req.task_id)?;let affected:std::collections::HashSet<_>=descendants.iter().cloned().collect();
        if live_edges(tx,&req.project.id)?.iter().any(|e|affected.contains(&e.source_task_id)||affected.contains(&e.target_task_id)){return Err(fail("TASK_MOVE_HAS_SEQUENCE_EDGES","请先解除受移动影响的顺序关系"));}
        let now=utc_now();
        let mut source_before:Vec<String>=tasks.iter().filter(|t|t.deleted_at_utc.is_none()&&t.parent_task_id==moving.parent_task_id).map(|t|t.id.clone()).collect(); source_before.sort_by_key(|id|tasks.iter().find(|t|t.id==*id).unwrap().sibling_position);
        let source:Vec<String>=source_before.iter().filter(|id|*id!=&req.task_id).cloned().collect();
        let mut target:Vec<String>=tasks.iter().filter(|t|t.deleted_at_utc.is_none()&&t.parent_task_id.as_deref()==Some(req.target_parent_task_id.as_str())).map(|t|t.id.clone()).collect(); target.sort_by_key(|id|tasks.iter().find(|t|t.id==*id).unwrap().sibling_position);
        let mut es=req.expected_source_sibling_ids.clone();let mut asrc=source_before;es.sort();asrc.sort();let mut et=req.expected_target_sibling_ids.clone();let mut at=target.clone();et.sort();at.sort();
        if es!=asrc||et!=at||req.target_ordered_sibling_ids.len()!=target.len()+1{return Err(fail("TASK_SIBLING_SET_MISMATCH","源或目标兄弟集合已变化"));}
        let ids:std::collections::HashSet<_>=target.iter().cloned().chain(std::iter::once(req.task_id.clone())).collect(); if req.target_ordered_sibling_ids.iter().cloned().collect::<std::collections::HashSet<_>>()!=ids{return Err(fail("TASK_SIBLING_SET_MISMATCH","目标排序必须完整包含移动任务及所有现存兄弟"));}
        tx.execute("UPDATE productivity_task SET parent_task_id=?1,updated_at_utc=?2 WHERE id=?3",params![req.target_parent_task_id,now,req.task_id]).map_err(sqlerr)?;
        for (i,id) in source.iter().enumerate(){tx.execute("UPDATE productivity_task SET sibling_position=?1,updated_at_utc=?2 WHERE id=?3",params![i as i64,now,id]).map_err(sqlerr)?;}
        for (i,id) in req.target_ordered_sibling_ids.iter().enumerate(){tx.execute("UPDATE productivity_task SET sibling_position=?1,updated_at_utc=?2 WHERE id=?3",params![i as i64,now,id]).map_err(sqlerr)?;}
        if moving_depth==2{tx.execute("INSERT INTO productivity_task_card_position(task_id,project_id,parent_task_id,x,y,updated_at_utc) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,parent_task_id=excluded.parent_task_id,x=excluded.x,y=excluded.y,updated_at_utc=excluded.updated_at_utc,deleted_at_utc=NULL",params![req.task_id,req.project.id,req.target_parent_task_id,req.position.x,req.position.y,now]).map_err(sqlerr)?;}
        bump(tx,&req.project.id,&now)?;response(tx,&req.project.id)
    }))
}

pub fn create_task_in_project(data_dir:&str,req:CreateTaskInProjectRequest)->DomainResult<ProjectResponse>{
    checked_root(&req.expected_data_dir,data_dir)?;validate_task_status(&req.status)?;if let Some(p)=&req.planned_point{validate_point(p)?;}if let Some(p)=&req.due_point{validate_point(p)?;}
    if let Some(p)=&req.initial_position{if !p.x.is_finite()||!p.y.is_finite(){return Err(fail("TASK_COORDINATE_INVALID","坐标必须是有限数值"));}}
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let tasks=project_guard(tx,&req.project)?;
        if let Some(parent)=&req.parent_task_id{task(&tasks,parent)?;}
        if req.new_initial_sequence.is_some(){let parent=req.parent_task_id.as_ref().and_then(|id|tasks.iter().find(|t|t.id==*id)).ok_or_else(||fail("TASK_SEQUENCE_ENDPOINT_INVALID","初始顺序线仅适用于第二层任务"))?;if parent.parent_task_id.is_some(){return Err(fail("TASK_SEQUENCE_ENDPOINT_INVALID","初始顺序线仅适用于第二层任务"));}}
        let anchor=req.new_initial_sequence.as_ref().map(|s|task(&tasks,&s.anchor_task_id)).transpose()?;
        if let (Some(s),Some(a))=(&req.new_initial_sequence,anchor){if !matches!(s.placement.as_str(),"before"|"after")||!second_level(&tasks,a)||a.parent_task_id!=req.parent_task_id{return Err(fail("TASK_SEQUENCE_ENDPOINT_INVALID","初始关系锚点必须是同父第二层任务"));}}
        let id=new_uuid();let now=utc_now();insert_task(tx,&id,&req.project.id,req.parent_task_id.as_deref(),&req.title,req.description.as_deref(),&req.status,point_to_json(&req.planned_point).as_deref(),point_to_json(&req.due_point).as_deref(),&now)?;
        super::super::classification::set_task_classification(tx,&id,req.item_type_id.as_deref(),req.classification_expected.as_ref())?;
        if let Some(p)=&req.initial_position{if req.parent_task_id.is_none()||req.parent_task_id.as_ref().and_then(|pid|tasks.iter().find(|t|t.id==*pid)).is_none_or(|t|t.parent_task_id.is_some()){return Err(fail("TASK_PARENT_INVALID","仅第二层任务可保存卡片坐标"));}tx.execute("INSERT INTO productivity_task_card_position(task_id,project_id,parent_task_id,x,y,updated_at_utc) VALUES(?1,?2,?3,?4,?5,?6)",params![id,req.project.id,req.parent_task_id,p.x,p.y,now]).map_err(sqlerr)?;}
        if let Some(s)=&req.new_initial_sequence{let (a,b)=if s.placement=="before"{(&id,&s.anchor_task_id)}else{(&s.anchor_task_id,&id)};tx.execute("INSERT INTO productivity_task_sequence_edge(id,project_id,source_task_id,target_task_id,created_at_utc,updated_at_utc) VALUES(?1,?2,?3,?4,?5,?5)",params![new_uuid(),req.project.id,a,b,now]).map_err(sqlerr)?;}
        bump(tx,&req.project.id,&now)?;response(tx,&req.project.id)
    }))
}

pub fn list_deleted_task_batches(data_dir:&str,req:ListDeletedTaskBatchesRequest)->DomainResult<DeletedTaskBatchesResponse>{
    checked_root(&req.expected_data_dir,data_dir)?;
    crate::productivity_db::coordinator::with_read(data_dir,|conn|{let conn=conn.ok_or_else(||DomainError::root_not_found("project not found"))?;in_transaction(conn,|tx|{
        let (project,extra)=load_project_row(tx,&req.project_id,true)?;guard_unknown(&extra)?;
        let mut stmt=tx.prepare("SELECT id,title,deletion_batch_id,deleted_at_utc,parent_task_id FROM productivity_task WHERE project_id=?1 AND deleted_at_utc IS NOT NULL AND deletion_batch_id IS NOT NULL ORDER BY deleted_at_utc,id").map_err(sqlerr)?;
        let rows=stmt.query_map([&req.project_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?))).map_err(sqlerr)?;
        let mut grouped:std::collections::BTreeMap<String,DeletedTaskBatchSnapshot>=std::collections::BTreeMap::new();for row in rows{let(id,title,batch,deleted,parent)=row.map_err(sqlerr)?;let entry=grouped.entry(batch.clone()).or_insert(DeletedTaskBatchSnapshot{deletion_batch_id:batch.clone(),root_task_id:String::new(),root_title:String::new(),task_ids:Vec::new(),edge_ids:Vec::new(),deleted_at_utc:deleted});let parent_in_batch=if let Some(p)=parent.as_ref(){tx.query_row("SELECT COUNT(*) FROM productivity_task WHERE id=?1 AND deletion_batch_id=?2",params![p,batch],|r|r.get::<_,i64>(0)).map_err(sqlerr)?>0}else{false};if !parent_in_batch&&entry.root_task_id.is_empty(){entry.root_task_id=id.clone();entry.root_title=title;}entry.task_ids.push(id);}
        for (batch_id,batch) in grouped.iter_mut(){batch.task_ids.sort();let mut edges=tx.prepare("SELECT id FROM productivity_task_sequence_edge WHERE project_id=?1 AND deletion_batch_id=?2 ORDER BY id").map_err(sqlerr)?;batch.edge_ids=edges.query_map(params![req.project_id,batch_id],|r|r.get::<_,String>(0)).map_err(sqlerr)?.collect::<Result<Vec<_>,_>>().map_err(sqlerr)?;}
        Ok(DeletedTaskBatchesResponse{project_id:project.id,project_revision:project.revision,batches:grouped.into_values().collect()})
    })})
}

pub fn set_task_status_guarded(data_dir:&str,req:SetTaskStatusGuardedRequest)->DomainResult<ProjectResponse>{
    checked_root(&req.expected_data_dir,data_dir)?;validate_task_status(&req.status)?;
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let tasks=project_guard(tx,&req.project)?;let selected=task(&tasks,&req.task_id)?;if selected.status==req.status{return response(tx,&req.project.id);}let scope=task_descendants(tx,&req.project.id,&req.task_id)?.into_iter().filter(|id|tasks.iter().any(|t|t.id==*id&&t.deleted_at_utc.is_none())).collect::<Vec<_>>();
        ensure_no_started_task_actions(tx,&scope)?;
        if crate::productivity_db::checkpoint::pending_refs_for_target(tx,"task",&req.task_id)?.len()>0{return Err(fail("TASK_PENDING_CHECKPOINT_BLOCKS_STATUS","所选任务存在未完成检查点，需先处理"));}
        let now=utc_now();tx.execute("UPDATE productivity_task SET status=?1,updated_at_utc=?2 WHERE id=?3",params![req.status,now,req.task_id]).map_err(sqlerr)?;bump(tx,&req.project.id,&now)?;response(tx,&req.project.id)
    }))
}

fn same_ids(expected:&[String],actual:&[String],code:&'static str,message:&'static str)->DomainResult<()> {let mut a=expected.to_vec();let mut b=actual.to_vec();a.sort();b.sort();if a!=b{Err(fail(code,message))}else{Ok(())}}
fn delete_run(tx:&Transaction,req:&DeleteTaskSubtreeRequest)->DomainResult<ProjectResponse>{
    project_guard(tx,&req.project)?; require_live_task_in_project(tx,&req.project.id,&req.task_id)?;
    let all=load_tasks_for_project(tx,&req.project.id,false)?;let ids:Vec<_>=task_descendants(tx,&req.project.id,&req.task_id)?.into_iter().filter(|id|all.iter().any(|t|t.id==*id&&t.deleted_at_utc.is_none())).collect();
    if let Some(expected)=&req.expected_subtree_task_ids{same_ids(expected,&ids,"TASK_DELETE_SCOPE_MISMATCH","删除范围已变化，请重新确认")?;}
    ensure_no_started_task_actions(tx,&ids)?;
    let idset:std::collections::HashSet<_>=ids.iter().cloned().collect();let edges=live_edges(tx,&req.project.id)?;
    let edge_ids:Vec<_>=edges.iter().filter(|e|idset.contains(&e.source_task_id)||idset.contains(&e.target_task_id)).map(|e|e.id.clone()).collect();
    if let Some(expected)=&req.expected_edge_ids{same_ids(expected,&edge_ids,"TASK_DELETE_SCOPE_MISMATCH","待删除关系范围已变化，请重新确认")?;}
    let now=utc_now();let batch=new_uuid();
    for id in &ids{tx.execute("UPDATE productivity_task SET deleted_at_utc=?1,updated_at_utc=?1,deletion_batch_id=?2 WHERE id=?3 AND deleted_at_utc IS NULL",params![now,batch,id]).map_err(sqlerr)?;}
    for id in &edge_ids{tx.execute("UPDATE productivity_task_sequence_edge SET deleted_at_utc=?1,updated_at_utc=?1,deletion_batch_id=?2 WHERE id=?3",params![now,batch,id]).map_err(sqlerr)?;}
    tx.execute("UPDATE productivity_task_card_position SET deleted_at_utc=?1,updated_at_utc=?1 WHERE task_id IN (SELECT id FROM productivity_task WHERE deletion_batch_id=?2)",params![now,batch]).map_err(sqlerr)?;
    bump(tx,&req.project.id,&now)?;response(tx,&req.project.id)
}
pub fn delete_task_subtree_exact(data_dir:&str,req:DeleteTaskSubtreeRequest)->DomainResult<ProjectResponse>{
    let run=|conn:&rusqlite::Connection|in_transaction(conn,|tx|delete_run(tx,&req));
    if let Some(expected)=req.expected_data_dir.as_deref(){checked_root(expected,data_dir)?;with_write_expected(expected,run)}else{with_write(data_dir,run)}
}

fn restore_run(tx:&Transaction,req:&RestoreTaskSubtreeRequest)->DomainResult<ProjectResponse>{
    project_guard(tx,&req.project)?;
    let batch=require_task_in_project_including_deleted(tx,&req.project.id,&req.task_id)?;
    if req.expected_deletion_batch_id.as_deref().is_some_and(|expected|expected!=batch){return Err(DomainError::delete_batch_mismatch());}
    let root_parent:Option<String>=tx.query_row("SELECT parent_task_id FROM productivity_task WHERE id=?1",[&req.task_id],|r|r.get(0)).map_err(sqlerr)?;
    if let Some(parent)=&root_parent {require_live_task_in_project(tx,&req.project.id,parent).map_err(|_|fail("TASK_RESTORE_PARENT_DELETED","请先恢复父任务"))?;}
    let tree=task_descendants(tx,&req.project.id,&req.task_id)?;
    let mut restore_ids=Vec::new();for id in tree{let b:Option<String>=tx.query_row("SELECT deletion_batch_id FROM productivity_task WHERE id=?1",[&id],|r|r.get(0)).optional().map_err(sqlerr)?.flatten();if b.as_deref()==Some(batch.as_str()){restore_ids.push(id);}}
    if restore_ids.is_empty()||!restore_ids.contains(&req.task_id){return Err(DomainError::delete_batch_mismatch());}
    if let Some(expected)=&req.expected_subtree_task_ids{same_ids(expected,&restore_ids,"TASK_RESTORE_SCOPE_MISMATCH","待恢复任务范围已变化")?;}
    let idset:std::collections::HashSet<_>=restore_ids.iter().cloned().collect();
    let mut stmt=tx.prepare("SELECT id,source_task_id,target_task_id,extra_json,source_anchor_json,target_anchor_json FROM productivity_task_sequence_edge WHERE project_id=?1 AND deletion_batch_id=?2 ORDER BY id").map_err(sqlerr)?;
    let rows=stmt.query_map(params![req.project.id,batch],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,task_sequence_anchor_from_row(r,"source_anchor_json")?,task_sequence_anchor_from_row(r,"target_anchor_json")?))).map_err(sqlerr)?;
    let mut candidates=Vec::new();for r in rows{let e=r.map_err(sqlerr)?;guard_unknown(&e.3)?;if idset.contains(&e.1)||idset.contains(&e.2){candidates.push(e);}}
    let candidate_ids:Vec<_>=candidates.iter().map(|e|e.0.clone()).collect();if let Some(expected)=&req.expected_edge_ids{same_ids(expected,&candidate_ids,"TASK_RESTORE_SCOPE_MISMATCH","待恢复关系范围已变化")?;}
    let now=utc_now();for id in &restore_ids{tx.execute("UPDATE productivity_task SET deleted_at_utc=NULL,updated_at_utc=?1 WHERE id=?2 AND deletion_batch_id=?3",params![now,id,batch]).map_err(sqlerr)?;}
    // SQLite has no array bind here: restore positions individually, preserving their original coordinates.
    for id in &restore_ids{tx.execute("UPDATE productivity_task_card_position SET deleted_at_utc=NULL,updated_at_utc=?1 WHERE task_id=?2",params![now,id]).map_err(sqlerr)?;}
    let all_tasks=load_tasks_for_project(tx,&req.project.id,true)?;let mut active=live_edges(tx,&req.project.id)?;let mut graph:Vec<_>=active.iter().map(|e|(e.source_task_id.clone(),e.target_task_id.clone())).collect();
    let mut restored_edges=Vec::new();let mut skipped=Vec::new();
    for (edge_id,source,target,_,source_anchor,target_anchor) in candidates{
        let endpoints_ok=all_tasks.iter().find(|t|t.id==source).zip(all_tasks.iter().find(|t|t.id==target)).is_some_and(|(a,b)|{let parents_match=a.parent_task_id.is_some()&&a.parent_task_id==b.parent_task_id&&second_level(&all_tasks,a)&&second_level(&all_tasks,b); parents_match});
        let duplicate=active.iter().any(|e|e.source_task_id==source&&e.target_task_id==target);
        let mut trial=graph.clone();trial.push((source.clone(),target.clone()));
        let reason=if !endpoints_ok{Some("TASK_SEQUENCE_ENDPOINT_INVALID")}else if duplicate{Some("TASK_SEQUENCE_DUPLICATE")}else if !edge_graph_acyclic(&trial){Some("TASK_SEQUENCE_CYCLE")}else{None};
        if let Some(reason_code)=reason{skipped.push(SkippedTaskSequenceEdge{edge_id,reason_code:reason_code.to_string()});continue;}
        tx.execute("UPDATE productivity_task_sequence_edge SET deleted_at_utc=NULL,deletion_batch_id=NULL,updated_at_utc=?1 WHERE id=?2",params![now,edge_id]).map_err(sqlerr)?;graph=trial;restored_edges.push(edge_id.clone());
        active.push(TaskSequenceEdgeSnapshot{id:edge_id,project_id:req.project.id.clone(),source_task_id:source,target_task_id:target,source_anchor,target_anchor,created_at_utc:now.clone(),updated_at_utc:now.clone(),deleted_at_utc:None,deletion_batch_id:None});
    }
    bump(tx,&req.project.id,&now)?;
    Ok(ProjectResponse{project:project_snapshot(tx,&req.project.id,true)?,restore_summary:Some(TaskRestoreSummary{restored_task_ids:restore_ids,restored_edge_ids:restored_edges,skipped_edges:skipped})})
}
pub fn restore_task_subtree_exact(data_dir:&str,req:RestoreTaskSubtreeRequest)->DomainResult<ProjectResponse>{
    let run=|conn:&rusqlite::Connection|in_transaction(conn,|tx|restore_run(tx,&req));
    if let Some(expected)=req.expected_data_dir.as_deref(){checked_root(expected,data_dir)?;with_write_expected(expected,run)}else{with_write(data_dir,run)}
}

pub fn restore_task_subtree_batch(data_dir:&str,req:RestoreTaskSubtreeBatchRequest)->DomainResult<ProjectResponse>{
    let expected=req.expected_data_dir.clone();
    restore_task_subtree_exact(data_dir,RestoreTaskSubtreeRequest{project:req.project,task_id:req.task_id,expected_data_dir:Some(expected),expected_edge_ids:Some(req.expected_edge_ids),expected_deletion_batch_id:Some(req.expected_deletion_batch_id),expected_subtree_task_ids:Some(req.expected_subtree_task_ids)})
}

