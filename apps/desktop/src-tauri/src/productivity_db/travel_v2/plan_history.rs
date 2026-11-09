//! Process-local plan effects only. No registry lock is held while acquiring
//! the Archive coordinator; SQLite receipts finalize matching pending writes
//! after commit, including delayed GetReceipt calls (SPEC-0015 §6.3).
use std::{collections::{BTreeMap, BTreeSet}, sync::{Mutex, OnceLock}};
use rusqlite::{params, OptionalExtension, Transaction};
use super::{model::*, read::load_trip_snapshot, receipt::{ensure_receipt, hash_command, store_receipt}};
use crate::productivity_db::{coordinator::{in_transaction, with_write_expected}, error::{DomainError, DomainResult},
    repository::{bump_action, bump_checkpoint, bump_item, check_members, check_revision, guard_unknown, load_action_row, load_item_row, load_intervals},
    util::{new_uuid, utc_now}, validation::ensure_list_writable};

#[derive(Clone, Debug)]
struct Point {
    id: String, item: String, schema: i64, attachment: String, action: Option<String>, checkpoint: Option<String>,
    role: String, label: Option<String>, location: Option<String>, note: Option<String>, origin: Option<String>,
    created: String, updated: String, deleted: Option<String>,
}
impl PartialEq for Point {
    fn eq(&self, p: &Self) -> bool {
        // Compare business/lifecycle endpoints, not historical timestamps. A
        // confirmed later Undo generates new timestamps for the same effect.
        self.id==p.id && self.item==p.item && self.schema==p.schema && self.attachment==p.attachment
            && self.action==p.action && self.checkpoint==p.checkpoint && self.role==p.role && self.label==p.label
            && self.location==p.location && self.note==p.note && self.origin==p.origin && self.created==p.created
            && self.deleted.is_some()==p.deleted.is_some()
    }
}
#[derive(Clone, PartialEq, Debug)]
struct ActionPlan { start: Option<String>, end: Option<String>, duration: Option<i64> }
#[derive(Clone, PartialEq)]
struct PointTopology {
    item: String, schema: i64, attachment: String, action: Option<String>, checkpoint: Option<String>, role: String, origin: Option<String>,
}
fn live_topology(points: &BTreeMap<String,Point>) -> BTreeMap<String,PointTopology> {
    points.iter().filter(|(_,p)|p.deleted.is_none()).map(|(id,p)|(id.clone(),PointTopology{
        item:p.item.clone(),schema:p.schema,attachment:p.attachment.clone(),action:p.action.clone(),checkpoint:p.checkpoint.clone(),role:p.role.clone(),origin:p.origin.clone(),
    })).collect()
}
#[derive(Clone, Default)]
struct State {
    actions: BTreeMap<String, ActionPlan>, checkpoints: BTreeMap<String, Option<String>>,
    points: BTreeMap<String, Option<Point>>,
    topology: BTreeMap<String,PointTopology>,
}
#[derive(Clone)]
struct Pending { request: String, from: bool, to: bool, sequence: u64, endpoint: State }
#[derive(Clone)]
struct Token {
    root: String, item: String, scope: PlanHistoryScope, original_request: String,
    before: State, after: State, current: State, applied: bool, sequence: u64,
    members: (BTreeSet<String>, BTreeSet<String>), pending: Option<Pending>,
}
#[derive(Default)]
struct Registry { tokens: BTreeMap<String, Token>, order: Vec<String>, owner_versions: BTreeMap<(String,String,u64),u64> }
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
fn registry() -> &'static Mutex<Registry> { REGISTRY.get_or_init(|| Mutex::new(Registry::default())) }
fn unavailable() -> DomainError { DomainError::restore_conflict("plan history unavailable, expired, or owned by another arrangement") }
fn lock() -> DomainResult<std::sync::MutexGuard<'static, Registry>> { registry().lock().map_err(|_| unavailable()) }

fn points(tx: &Transaction<'_>, item: &str) -> DomainResult<BTreeMap<String, Point>> {
    let mut stmt = tx.prepare("SELECT id,item_id,schema_version,attachment_kind,action_id,checkpoint_id,role,action_label,location,note,origin_checkpoint_id,created_at_utc,updated_at_utc,deleted_at_utc FROM productivity_item_travel_point WHERE item_id=?1")
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let rows = stmt.query_map([item], |r| Ok(Point { id:r.get(0)?,item:r.get(1)?,schema:r.get(2)?,attachment:r.get(3)?,action:r.get(4)?,checkpoint:r.get(5)?,
        role:r.get(6)?,label:r.get(7)?,location:r.get(8)?,note:r.get(9)?,origin:r.get(10)?,created:r.get(11)?,updated:r.get(12)?,deleted:r.get(13)? }))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut out = BTreeMap::new();
    for row in rows { let p = row.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?; out.insert(p.id.clone(),p); }
    Ok(out)
}

fn capture(tx: &Transaction<'_>, snapshot: &TripSnapshot) -> DomainResult<State> {
    let mut state = State::default();
    for a in &snapshot.actions {
        let (a, extra) = load_action_row(tx,&a.id,true)?;
        guard_unknown(&extra)?;
        state.actions.insert(a.id, ActionPlan { start:a.planned_start_at,end:a.planned_end_at,duration:a.planned_duration });
    }
    for c in &snapshot.checkpoints {
        let cp = crate::productivity_db::checkpoint::snapshot(tx,&c.id,false)?;
        state.checkpoints.insert(cp.id,cp.planned_at_utc);
    }
    let all_points=points(tx,&snapshot.item.id)?;
    state.topology=live_topology(&all_points);
    state.points=all_points.into_iter().map(|(id,p)|(id,Some(p))).collect();
    Ok(state)
}

fn guard_root(tx: &Transaction<'_>, snapshot: &TripSnapshot) -> DomainResult<()> {
    let (item, extra) = load_item_row(tx,&snapshot.item.id,true)?;
    guard_unknown(&extra)?;
    ensure_list_writable(tx,item.list_id.as_deref())?;
    let profile: (i64,Option<String>) = tx.query_row("SELECT schema_version,deleted_at_utc FROM productivity_item_travel_profile WHERE item_id=?1",[&item.id],|r|Ok((r.get(0)?,r.get(1)?)))
        .map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    if profile.0 != SUPPORTED_PROFILE_SCHEMA || profile.1.is_some() { return Err(DomainError::unknown_format_readonly("unsupported or deleted travel profile")); }
    if snapshot.item.completed || snapshot.item.cancelled { return Err(DomainError::protected_structure("trip plan frozen")); }
    Ok(())
}

fn members(snapshot: &TripSnapshot) -> (BTreeSet<String>,BTreeSet<String>) {
    (snapshot.actions.iter().map(|a|a.id.clone()).collect(),snapshot.checkpoints.iter().map(|c|c.id.clone()).collect())
}

fn diff(before: State, after: State) -> DomainResult<(State,State)> {
    if before.actions.keys().ne(after.actions.keys()) || before.checkpoints.keys().ne(after.checkpoints.keys()) {
        return Err(DomainError::protected_structure("plan effects cannot create or delete roots"));
    }
    let mut b = State::default(); let mut a = State::default();
    b.topology=before.topology.clone();a.topology=after.topology.clone();
    for (id,value) in &before.actions { if after.actions.get(id) != Some(value) { b.actions.insert(id.clone(),value.clone()); a.actions.insert(id.clone(),after.actions[id].clone()); } }
    for (id,value) in &before.checkpoints { if after.checkpoints.get(id) != Some(value) { b.checkpoints.insert(id.clone(),value.clone()); a.checkpoints.insert(id.clone(),after.checkpoints[id].clone()); } }
    let ids: BTreeSet<_> = before.points.keys().chain(after.points.keys()).cloned().collect();
    for id in ids {
        let old = before.points.get(&id).cloned().flatten(); let new = after.points.get(&id).cloned().flatten();
        let touched=old.as_ref().zip(new.as_ref()).is_some_and(|(o,n)|o.updated!=n.updated);
        if old != new || touched { b.points.insert(id.clone(),old); a.points.insert(id,new); }
    }
    Ok((b,a))
}

fn guard_effect(tx: &Transaction<'_>, snapshot: &TripSnapshot, before: &State, after: &State) -> DomainResult<()> {
    let mut actions: BTreeSet<_> = before.actions.keys().chain(after.actions.keys()).cloned().collect();
    let mut checkpoints: BTreeSet<_> = before.checkpoints.keys().chain(after.checkpoints.keys()).cloned().collect();
    for point in before.points.values().chain(after.points.values()).flatten() {
        if point.item != snapshot.item.id || point.schema != SUPPORTED_MEMBER_SCHEMA { return Err(DomainError::unknown_format_readonly("unsupported point manifest")); }
        if let Some(id) = &point.action { actions.insert(id.clone()); }
        if let Some(id) = &point.checkpoint { checkpoints.insert(id.clone()); }
    }
    for id in actions {
        let view = snapshot.actions.iter().find(|a|a.id==id).ok_or_else(||DomainError::cross_item_reference("effect action no longer belongs to trip"))?;
        let (action,extra)=load_action_row(tx,&id,true)?; guard_unknown(&extra)?;
        if action.target_kind.as_deref()!=Some("item") || action.target_id.as_deref()!=Some(snapshot.item.id.as_str()) || action.session_id.is_some() {
            return Err(DomainError::cross_item_reference("effect action ownership changed"));
        }
        if super::validation::action_frozen(view,snapshot.item.completed,snapshot.item.cancelled) || !load_intervals(tx,&id,true)?.is_empty() {
            return Err(DomainError::protected_structure("effect action actual/execution freezes plan"));
        }
        let actual_schema: Option<i64> = tx.query_row("SELECT schema_version FROM productivity_action_travel_actual_v2 WHERE action_id=?1 AND deleted_at_utc IS NULL",[&id],|r|r.get(0)).optional().map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        if actual_schema.is_some_and(|s|s!=1) { return Err(DomainError::unknown_format_readonly("unsupported actual schema")); }
    }
    for id in checkpoints {
        let cp=crate::productivity_db::checkpoint::snapshot(tx,&id,false)?;
        if !snapshot.checkpoints.iter().any(|c|c.id==id) || cp.target_kind.as_deref()!=Some("item") || cp.target_id.as_deref()!=Some(snapshot.item.id.as_str()) || cp.session_id.is_some() {
            return Err(DomainError::cross_item_reference("effect checkpoint ownership changed"));
        }
        if super::validation::checkpoint_frozen(&cp,snapshot.item.completed,snapshot.item.cancelled) { return Err(DomainError::protected_structure("effect checkpoint actual/completion freezes plan")); }
    }
    Ok(())
}

fn check_endpoint(tx: &Transaction<'_>, snapshot: &TripSnapshot, expected: &State) -> DomainResult<()> {
    let actual = capture(tx,snapshot)?;
    // Protect all live associations even for time-only effects. Unrelated
    // managed tombstones from a later confirmed Undo are not live topology.
    if actual.topology!=expected.topology {return Err(DomainError::restore_conflict("trip point topology changed"));}
    for (id,p) in &expected.actions { if actual.actions.get(id)!=Some(p) { return Err(DomainError::restore_conflict("action plan effect changed")); } }
    for (id,p) in &expected.checkpoints { if actual.checkpoints.get(id)!=Some(p) { return Err(DomainError::restore_conflict("checkpoint plan effect changed")); } }
    for (id,p) in &expected.points {
        if actual.points.get(id).cloned().flatten()!=*p { return Err(DomainError::restore_conflict("point manifest changed, including tombstones")); }
        // Absence is global, not just absence from this trip's projection.
        if p.is_none() {
            let exists: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_travel_point WHERE id=?1)",[id],|r|r.get(0)).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            if exists { return Err(DomainError::restore_conflict("point identity already owned")); }
        }
    }
    Ok(())
}

fn status(token: &Token, request: &str, sequence: u64) -> PlanHistoryStatus {
    PlanHistoryStatus { owner_id:token.scope.owner_id.clone(),host_epoch:token.scope.host_epoch,request_id:request.into(),sequence,
        phase:if token.applied {"applied"} else {"undone"}.into(),available:token.pending.is_none() }
}

/// Receipt fields retain the original operation identity/sequence. Only the
/// current availability/phase is redecorated; stale receipts cannot undo phase.
pub fn finalize_result(root: &str, request: &str, mut result: TravelMutationResult) -> DomainResult<TravelMutationResult> {
    let Some(id)=result.plan_history_token.as_ref() else { return Ok(result); };
    let mut registry=match lock() {Ok(r)=>r,Err(_)=>{if let Some(s)=result.plan_history.as_mut(){s.available=false;s.phase="unavailable".into();}return Ok(result);}};
    if let Some(token)=registry.tokens.get_mut(id).filter(|t|t.root==root) {
        if let Some(p)=token.pending.clone().filter(|p|p.request==request && result.plan_history.as_ref().is_some_and(|s|s.sequence==p.sequence)) {
            if token.applied==p.from {
                token.applied=p.to; token.sequence=p.sequence; token.current=p.endpoint; token.pending=None;
            }
        }
        if let Some(s)=result.plan_history.as_mut() { s.phase=if token.applied {"applied"}else{"undone"}.into();s.available=token.pending.is_none(); }
    } else if let Some(s)=result.plan_history.as_mut() { s.available=false; s.phase="unavailable".into(); }
    // Pending reservations are unpublished. Trim only after confirmed commit,
    // so a failed edit never discards the oldest still-usable history entry.
    if let Some(scope)=registry.tokens.get(id).filter(|t|t.pending.is_none()).map(|t|t.scope.clone()) {
        let owned:Vec<_>=registry.order.iter().filter(|key|registry.tokens.get(*key).is_some_and(|t|t.root==root && t.scope==scope && t.pending.is_none())).cloned().collect();
        for oldest in owned.iter().take(owned.len().saturating_sub(100)) {
            registry.tokens.remove(oldest);registry.order.retain(|key|key!=oldest);
        }
    }
    Ok(result)
}

fn reserve_new(root: &str,item: &str,scope: &PlanHistoryScope,owner_version: u64,request: &str,before: State,after: State,snapshot: &TripSnapshot) -> DomainResult<(String,PlanHistoryStatus)> {
    if scope.owner_id.trim().is_empty() { return Err(DomainError::invalid_patch("history owner required")); }
    let id=new_uuid();
    let token=Token {root:root.into(),item:item.into(),scope:scope.clone(),original_request:request.into(),before,after:after.clone(),current:after.clone(),applied:false,sequence:0,
        members:members(snapshot),pending:Some(Pending{request:request.into(),from:false,to:true,sequence:1,endpoint:after})};
    let mut status=status(&token,request,1);status.phase="applied".into();status.available=true;
    let mut registry=lock()?;
    if registry.owner_versions.get(&(root.into(),scope.owner_id.clone(),scope.host_epoch)).copied().unwrap_or(0)!=owner_version {
        return Err(DomainError::restore_conflict("history owner released while edit was pending"));
    }
    if registry.tokens.values().any(|t|t.root==root && t.original_request==request) { return Err(DomainError::restore_conflict("history request pending")); }
    registry.tokens.insert(id.clone(),token);registry.order.push(id.clone());
    Ok((id,status))
}

pub fn edit_plan(data_dir: &str,envelope: TravelMutationEnvelope<EditPlanPayload>) -> DomainResult<TravelMutationResult> {
    if data_dir!=envelope.expected_data_dir { return Err(DomainError::archive_lifecycle("dataDir changed")); }
    let item=envelope.item_ref.as_ref().ok_or_else(||DomainError::invalid_patch("itemRef required"))?.id.clone();
    if envelope.payload.history_scope.as_ref().is_some_and(|s|s.owner_id.trim().is_empty()) {return Err(DomainError::invalid_patch("history owner required"));}
    let owner_version=if let Some(scope)=&envelope.payload.history_scope {
        Some(lock()?.owner_versions.get(&(envelope.expected_data_dir.clone(),scope.owner_id.clone(),scope.host_epoch)).copied().unwrap_or(0))
    } else {None};
    let hash=hash_command("productivity_travel_v2_edit_plan",&serde_json::to_string(&envelope).map_err(|e|DomainError::invalid_patch(e.to_string()))?);
    let mut reservation=None; let mut prepared=false;
    let result=with_write_expected(&envelope.expected_data_dir,|conn|in_transaction(conn,|tx| {
        if let Some(existing)=ensure_receipt(tx,&envelope.request_id,&hash,Some(&item))? { return Ok(existing); }
        let snapshot=load_trip_snapshot(tx,&item)?;guard_root(tx,&snapshot)?;
        check_revision(envelope.item_ref.as_ref().unwrap().expected_revision,snapshot.item.revision)?;
        check_members(&envelope.action_refs,&snapshot.member_refs.actions)?;check_members(&envelope.checkpoint_refs,&snapshot.member_refs.checkpoints)?;
        let before=capture(tx,&snapshot)?;
        tx.execute_batch("SAVEPOINT travel_plan_effect").map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        super::plan_edit::apply_edit_plan(tx,&item,&envelope.payload.edit,envelope.payload.resolutions.as_ref(),&snapshot)?;
        let after_snapshot=load_trip_snapshot(tx,&item)?;
        let after=capture(tx,&after_snapshot)?;
        let (before,after)=diff(before,after)?;
        let changed=!after.actions.is_empty() || !after.checkpoints.is_empty()
            || after.points.iter().any(|(id,p)|before.points.get(id)!=Some(p));
        guard_effect(tx,&snapshot,&before,&after)?;
        if !changed {
            tx.execute_batch("ROLLBACK TO travel_plan_effect").map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        }
        tx.execute_batch("RELEASE travel_plan_effect").map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        if changed { bump_item(tx,&item,&utc_now())?; }
        let snapshot=load_trip_snapshot(tx,&item)?;
        let mut result=TravelMutationResult {changed,snapshot,affected_root_refs:vec![],batch_id:None,adoption_report:None,plan_history_token:None,plan_history:None};
        result.affected_root_refs=changed_refs(&result.snapshot,&item,&after,changed);
        if changed {
            if let Some(scope)=&envelope.payload.history_scope {
                match reserve_new(&envelope.expected_data_dir,&item,scope,owner_version.unwrap_or(0),&envelope.request_id,before,after,&result.snapshot) {
                    Ok((id,status))=>{reservation=Some(id.clone());result.plan_history_token=Some(id);result.plan_history=Some(status);}
                    Err(_)=>{result.plan_history=Some(PlanHistoryStatus{owner_id:scope.owner_id.clone(),host_epoch:scope.host_epoch,request_id:envelope.request_id.clone(),sequence:0,phase:"unavailable".into(),available:false});}
                }
            }
        }
        store_receipt(tx,&envelope.request_id,&hash,Some(&item),&result)?;prepared=true;Ok(result)
    }));
    finish(&envelope.expected_data_dir,&envelope.request_id,reservation,prepared,result)
}

fn changed_refs(snapshot: &TripSnapshot,item: &str,state: &State,changed: bool) -> Vec<crate::productivity_db::types::RevisionRef> {
    let mut refs=Vec::new();
    if changed { refs.push(crate::productivity_db::types::RevisionRef{id:item.into(),expected_revision:snapshot.item.revision}); }
    refs.extend(snapshot.member_refs.actions.iter().filter(|r|state.actions.contains_key(&r.id)).cloned());
    refs.extend(snapshot.member_refs.checkpoints.iter().filter(|r|state.checkpoints.contains_key(&r.id)).cloned());refs
}

fn finish(root: &str,request: &str,reservation: Option<String>,prepared: bool,result: DomainResult<TravelMutationResult>) -> DomainResult<TravelMutationResult> {
    match result {
        Ok(result)=>finalize_result(root,request,result),
        Err(error)=>{
            // A closure failure is confirmed rollback. A COMMIT failure keeps
            // pending frozen for receipt reconciliation; never guess its phase.
            if !prepared { if let Some(id)=reservation { let mut registry=lock()?;if let Some(t)=registry.tokens.get_mut(&id) {
                if t.original_request==request && t.sequence==0 {registry.tokens.remove(&id);registry.order.retain(|i|i!=&id);} else {t.pending=None;}
            } } }
            Err(error)
        }
    }
}

pub fn replay(data_dir: &str,req: ReplayTravelPlanEffectRequest) -> DomainResult<TravelMutationResult> {
    if data_dir!=req.expected_data_dir {return Err(DomainError::archive_lifecycle("dataDir changed"));}
    let hash=hash_command("productivity_travel_v2_replay_plan_effect",&serde_json::to_string(&req).map_err(|e|DomainError::invalid_patch(e.to_string()))?);
    let mut reservation=None;let mut prepared=false;
    let result=with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx| {
        if let Some(existing)=ensure_receipt(tx,&req.request_id,&hash,Some(&req.current_trip_refs.item.id))? {return Ok(existing);}
        let to=match req.direction.as_str(){"undo"=>false,"redo"=>true,_=>return Err(DomainError::invalid_patch("direction must be undo or redo"))};
        let token={
            let mut registry=lock()?;
            let t=registry.tokens.get_mut(&req.plan_history_token).ok_or_else(unavailable)?;
            if t.root!=req.expected_data_dir || t.item!=req.current_trip_refs.item.id || t.scope.owner_id!=req.history_owner_id || t.scope.host_epoch!=req.host_epoch {return Err(unavailable());}
            if t.pending.is_some() || t.applied==to {return Err(DomainError::restore_conflict("history phase is pending or direction is stale"));}
            let tcopy=t.clone();t.pending=Some(Pending{request:req.request_id.clone(),from:t.applied,to,sequence:t.sequence+1,endpoint:t.current.clone()});tcopy
        };
        reservation=Some(req.plan_history_token.clone());
        let snapshot=load_trip_snapshot(tx,&token.item)?;guard_root(tx,&snapshot)?;
        check_revision(req.current_trip_refs.item.expected_revision,snapshot.item.revision)?;
        check_members(&req.current_trip_refs.actions,&snapshot.member_refs.actions)?;check_members(&req.current_trip_refs.checkpoints,&snapshot.member_refs.checkpoints)?;
        if members(&snapshot)!=token.members {return Err(DomainError::restore_conflict("trip membership changed"));}
        check_endpoint(tx,&snapshot,&token.current)?;guard_effect(tx,&snapshot,&token.before,&token.after)?;
        let target=if to {&token.after}else{&token.before};
        apply(tx,target,&token.current)?;
        bump_item(tx,&token.item,&utc_now())?;
        let snapshot=load_trip_snapshot(tx,&token.item)?;
        let mut endpoint=target.clone();let actual=points(tx,&token.item)?;
        endpoint.topology=live_topology(&actual);
        for (id,p) in endpoint.points.iter_mut() { *p=actual.get(id).cloned(); }
        let result=TravelMutationResult{changed:true,affected_root_refs:changed_refs(&snapshot,&token.item,target,true),snapshot,batch_id:None,adoption_report:None,
            plan_history_token:Some(req.plan_history_token.clone()),plan_history:Some(PlanHistoryStatus{owner_id:req.history_owner_id.clone(),host_epoch:req.host_epoch,request_id:req.request_id.clone(),sequence:token.sequence+1,phase:if to {"applied"}else{"undone"}.into(),available:true})};
        { let mut registry=lock()?;let t=registry.tokens.get_mut(&req.plan_history_token).ok_or_else(unavailable)?;
          let p=t.pending.as_mut().filter(|p|p.request==req.request_id).ok_or_else(unavailable)?;p.endpoint=endpoint; }
        store_receipt(tx,&req.request_id,&hash,Some(&token.item),&result)?;prepared=true;Ok(result)
    }));
    finish(&req.expected_data_dir,&req.request_id,reservation,prepared,result)
}

fn apply(tx: &Transaction<'_>,target: &State,current: &State) -> DomainResult<()> {
    let now=utc_now();
    // Free all affected live attachments before reviving old fixed identities.
    for id in target.points.keys() {
        tx.execute("UPDATE productivity_item_travel_point SET deleted_at_utc=COALESCE(deleted_at_utc,?1),updated_at_utc=?1 WHERE id=?2",params![now,id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
    }
    for (id,p) in &target.points {
        if let Some(p)=p {
            // Every identity already exists after EditPlan; Undo never deletes a
            // newly allocated point, so Redo reuses the same managed tombstone.
            let count=tx.execute("UPDATE productivity_item_travel_point SET attachment_kind=?1,action_id=?2,checkpoint_id=?3,role=?4,action_label=?5,location=?6,note=?7,origin_checkpoint_id=?8,deleted_at_utc=?9,updated_at_utc=?10 WHERE id=?11 AND item_id=?12 AND schema_version=?13",
                params![p.attachment,p.action,p.checkpoint,p.role,p.label,p.location,p.note,p.origin,p.deleted,now,id,p.item,p.schema]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
            if count!=1 {return Err(DomainError::restore_conflict("point identity unavailable"));}
        } else if current.points.get(id).and_then(|p|p.as_ref()).is_none() {return Err(DomainError::restore_conflict("new point identity missing"));}
    }
    for (id,a) in &target.actions {
        tx.execute("UPDATE productivity_action SET planned_start_at=?1,planned_end_at=?2,planned_duration_seconds=?3,updated_at_utc=?4 WHERE id=?5",params![a.start,a.end,a.duration,now,id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        bump_action(tx,id,&now)?;
    }
    for (id,at) in &target.checkpoints {
        tx.execute("UPDATE productivity_checkpoint SET planned_at_utc=?1,updated_at_utc=?2 WHERE id=?3",params![at,now,id]).map_err(|e|DomainError::archive_lifecycle(e.to_string()))?;
        bump_checkpoint(tx,id,&now)?;
    }
    Ok(())
}

pub fn release(req: ReleaseTravelPlanHistoryRequest) -> DomainResult<()> {
    if req.history_owner_id.trim().is_empty() || (req.all && req.token_ids.is_some()) || (!req.all && req.token_ids.is_none()) {return Err(DomainError::invalid_patch("release requires tokenIds or all"));}
    let mut registry=lock()?;
    if req.all {
        let version=registry.owner_versions.entry((req.expected_data_dir.clone(),req.history_owner_id.clone(),req.host_epoch)).or_default();
        *version=version.wrapping_add(1);
    }
    let ids: BTreeSet<_>=req.token_ids.unwrap_or_default().into_iter().collect();
    // Pending tokens can be released too: their transaction may finish, but its
    // receipt is then explicitly decorated unavailable and cannot resurrect it.
    registry.tokens.retain(|id,t|!(t.root==req.expected_data_dir && t.scope.owner_id==req.history_owner_id && t.scope.host_epoch==req.host_epoch && (req.all || ids.contains(id))));
    let existing: BTreeSet<_>=registry.tokens.keys().cloned().collect();registry.order.retain(|id|existing.contains(id));Ok(())
}

#[cfg(test)]
#[path = "../tests/travel_v2_plan_history.rs"]
mod tests;
