//! Item-owned Health references. Health roots remain read-only (SPEC-0009).
use chrono::{DateTime, FixedOffset};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::{coordinator::{in_transaction, with_write_expected}, error::{DomainError, DomainResult}, repository::*, types::*, util::{new_uuid, utc_now}};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct HealthSourceRef { pub kind: String, pub id: String, pub expected_revision: i64 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct HealthPlanRefs { pub item: RevisionRef, pub action: RevisionRef }
#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct CreateHealthPlanRequest {
    pub expected_data_dir: String, pub kind: String, pub start: String, pub end: String,
    pub activity_type: Option<String>, pub catalog: Option<RevisionRef>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct HealthPlanRequest {
    pub expected_data_dir: String, pub item: RevisionRef, pub action: RevisionRef,
    pub source: Option<HealthSourceRef>, pub start: Option<String>, pub end: Option<String>,
    pub operation: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct WeekHealthRequest { pub expected_data_dir: String, pub start: String, pub end: String, #[serde(default)] pub include_activity_pauses: bool }
#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ReconcileHealthRequest {
    pub expected_data_dir: String, pub plans: Vec<HealthPlanRefs>, pub sources: Vec<HealthSourceRef>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct HealthPlanDetail {
    pub kind: String, pub activity_type: Option<String>, pub health_kind: Option<String>,
    pub health_id: Option<String>, pub auto_match_enabled: bool, pub invalid_source: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct HealthPlanSnapshot { pub item: ItemSnapshot, pub action: ActionSnapshot, pub detail: HealthPlanDetail }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct WeekHealthSource {
    pub kind: String, pub id: String, pub revision: i64, pub start: i64, pub end: i64,
    pub wake_date: Option<String>, pub title: String, pub activity_type: Option<String>,
    pub slot: Option<String>, pub icon_key: Option<String>, pub segments: Option<Value>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct WeekHealthResponse {
    pub plans: Vec<HealthPlanSnapshot>, pub sources: Vec<WeekHealthSource>,
    pub catalog: Option<ItemTypeCatalogSnapshot>,
}

pub(crate) fn instant(value: &str) -> DomainResult<i64> {
    DateTime::parse_from_rfc3339(value).map(|v| v.timestamp_millis())
        .map_err(|_| DomainError::invalid_patch("valid timestamp required"))
}
fn range(start: &str, end: &str) -> DomainResult<()> {
    if instant(start)? >= instant(end)? { return Err(DomainError::invalid_patch("end must follow start")); }
    super::validation::validate_action_plan(Some(start), Some(end), None)
}

/// Explicit user writes may initialize the catalog; reads never seed presets.
fn ensure_roles(tx: &Transaction, expected: Option<&RevisionRef>) -> DomainResult<ItemTypeCatalogSnapshot> {
    let current = super::classification::catalog_snapshot(tx)?;
    let now = utc_now();
    let id = if let Some(catalog) = current {
        let extra:String=tx.query_row("SELECT extra_json FROM productivity_item_type_catalog WHERE id=?1",[&catalog.id],|r|r.get(0))?; guard_unknown(&extra)?;
        let reference = expected.ok_or_else(|| DomainError::invalid_patch("catalog revision required"))?;
        if reference.id != catalog.id { return Err(DomainError::revision_conflict("catalog changed")); }
        super::classification::catalog_ref(tx, reference)?;
        catalog.id
    } else {
        if expected.is_some() { return Err(DomainError::revision_conflict("catalog no longer exists")); }
        let id = new_uuid();
        tx.execute("INSERT INTO productivity_item_type_catalog(id,revision,created_at_utc,updated_at_utc) VALUES(?1,0,?2,?2)", params![id,now])?;
        id
    };
    let mut changed = false;
    // Initial colors are the built-in category mains: blue, green, orange.
    // Existing system roles are left unchanged.
    for (role, name, color) in [("sleep","睡眠","#4879ED"),("activity","运动","#28A65D"),("meal","饮食","#E87524")] {
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_type WHERE system_role=?1)",[role],|r| r.get(0))?;
        if exists { continue; }
        // Never adopt a user's same-named node. A separate stable role owns this preset.
        let mut label=name.to_string();let mut suffix=0;
        while tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_type WHERE name_key=?1)",[&label],|r|r.get::<_,bool>(0))? {
            suffix+=1;label=if suffix==1{format!("{name}（系统）")}else{format!("{name}（系统 {suffix}）")};
        }
        let key = label.clone();
        tx.execute("INSERT INTO productivity_item_type(id,catalog_id,name,name_key,color_override,inactive,created_at_utc,updated_at_utc,system_role) VALUES(?1,?2,?3,?4,?5,0,?6,?6,?7)",params![new_uuid(),id,label,key,color,now,role])?;
        changed = true;
    }
    if changed { super::classification::bump_catalog(tx,&id,&now)?; }
    super::classification::catalog_snapshot(tx)?.ok_or_else(|| DomainError::root_not_found("catalog not found"))
}

pub fn create(req: CreateHealthPlanRequest) -> DomainResult<HealthPlanSnapshot> {
    if !matches!(req.kind.as_str(),"sleep"|"activity") { return Err(DomainError::invalid_patch("invalid health plan kind")); }
    if req.kind == "activity" && req.activity_type.as_deref().map(str::trim).unwrap_or("").is_empty() { return Err(DomainError::invalid_patch("activityType required")); }
    range(&req.start,&req.end)?;
    with_write_expected(&req.expected_data_dir,|conn| in_transaction(conn,|tx| {
        let catalog = ensure_roles(tx,req.catalog.as_ref())?;
        let node = catalog.item_types.iter().find(|n|n.system_role.as_deref()==Some(req.kind.as_str())).ok_or_else(||DomainError::root_not_found("health classification missing"))?;
        if node.effective_inactive { return Err(DomainError::invalid_patch("health classification is inactive")); }
        let item = new_uuid(); let action = new_uuid(); let now = utc_now();
        let title = if req.kind == "sleep" { "睡眠计划".to_string() } else { format!("运动计划 · {}",req.activity_type.as_deref().unwrap_or("")) };
        insert_item(tx,&item,None,&title,None,"进行中","none",None,None,&now)?;
        // Dedicated creation owns the detail and classification together; ordinary Item creation cannot impersonate this aggregate.
        tx.execute("UPDATE productivity_item SET item_type_id=?1 WHERE id=?2",params![node.id,item])?;
        insert_action(tx,&action,&title,None,None,Some("item"),Some(&item),Some(&req.start),Some(&req.end),None,false,None,&now)?;
        tx.execute("INSERT INTO productivity_item_health_plan(item_id,action_id,kind,activity_type,auto_match_enabled) VALUES(?1,?2,?3,?4,1)",params![item,action,req.kind,req.activity_type])?;
        append_item_to_order(tx,&item,&now)?;
        snapshot(tx,&item,false)
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct EnsureHealthRequest { pub expected_data_dir: String, pub catalog: Option<RevisionRef> }
pub fn ensure(req: EnsureHealthRequest) -> DomainResult<ItemTypeCatalogSnapshot> {
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|ensure_roles(tx,req.catalog.as_ref())))
}

pub(crate) fn sources(conn: &Connection) -> DomainResult<Vec<WeekHealthSource>> {
    let mut result = Vec::new();
    for (table,kind,payload) in [("health_sleep_night","sleep-night","night_json")] {
        let sql = format!("SELECT id,revision,wake_local_date,{payload} FROM {table} WHERE deleted_at_utc IS NULL");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?)))?;
        for row in rows {
            let (id,revision,wake_date,json) = row?;
            let value: Value = serde_json::from_str(&json).map_err(|_|DomainError::invalid_patch("睡眠资料 JSON 异常"))?;
            let (s,e) = if kind=="nap" { ("start","end") } else { ("sleep","wake") };
            let start = value[s].as_i64().and_then(|n|n.checked_mul(1000)).ok_or_else(||DomainError::invalid_patch("睡眠资料开始时间异常"))?;
            let end = value[e].as_i64().and_then(|n|n.checked_mul(1000)).ok_or_else(||DomainError::invalid_patch("睡眠资料结束时间异常"))?;
            if start >= end { return Err(DomainError::invalid_patch("睡眠资料时间范围异常")); }
            result.push(WeekHealthSource{kind:kind.into(),id,revision,start,end,wake_date:Some(wake_date),title:if kind=="nap"{"小睡"}else{"睡眠"}.into(),activity_type:None,slot:None,icon_key:None,segments:value.get("levelSegments").cloned()});
        }
    }
    let mut stmt=conn.prepare("SELECT id,revision,wake_local_date,started_at_utc,ended_at_utc FROM health_nap WHERE deleted_at_utc IS NULL")?;
    for row in stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?)))? {
        let(id,revision,wake_date,start,end)=row?;let start=instant(&start)?;let end=instant(&end)?;
        if start>=end{return Err(DomainError::invalid_patch("小睡资料时间范围异常"));}
        result.push(WeekHealthSource{kind:"nap".into(),id,revision,start,end,wake_date:Some(wake_date),title:"小睡".into(),activity_type:None,slot:None,icon_key:None,segments:None});
    }
    let mut stmt = conn.prepare("SELECT id,revision,started_at_utc,ended_at_utc,title,type_key,elapsed_duration_seconds FROM health_activity WHERE deleted_at_utc IS NULL AND source='garmin' AND suspected_duplicate_of IS NULL")?;
    for row in stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<f64>>(6)?)))? {
        let(id,revision,start,end,title,activity_type,elapsed_seconds)=row?;
        let Some(start)=start.as_deref().and_then(|s|instant(s).ok()) else {continue;};
        let end=match end {
            // SPEC-0009: only a missing end permits derivation. A supplied but
            // invalid end is not concealed by another field; it stays unavailable.
            Some(end)=>match instant(&end) {Ok(end) if end>start=>end,_=>continue},
            None=>{
                // Garmin summary.elapsedDuration -> elapsedDurationSeconds ->
                // elapsed_duration_seconds is seconds, distinct from duration /
                // movingDuration (garmin_normalize.py and Health repository).
                // This read-only projection rounds to its existing millisecond
                // precision; non-finite/nonpositive/rounded-zero/overflow stays unavailable.
                let Some(seconds)=elapsed_seconds.filter(|s|s.is_finite()&&*s>0.0) else {continue;};
                let milliseconds=(seconds*1000.0).round();
                if !milliseconds.is_finite()||milliseconds<=0.0||milliseconds>=i64::MAX as f64 {continue;}
                let Some(end)=start.checked_add(milliseconds as i64) else {continue;};
                if end<=start||DateTime::<chrono::Utc>::from_timestamp_millis(end).is_none() {continue;}
                end
            }
        };
        result.push(WeekHealthSource{kind:"activity".into(),id,revision,start,end,wake_date:None,title:title.unwrap_or_else(||"运动".into()),activity_type,slot:None,icon_key:None,segments:None});
    }
    let mut stmt = conn.prepare("SELECT id,revision,started_at_utc,title,slot,icon_key FROM health_meal WHERE deleted_at_utc IS NULL AND at_hm IS NOT NULL AND at_hm<>''")?;
    for row in stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?)))? {
        let(id,revision,s,title,slot,icon_key)=row?;
        if let Ok(start)=instant(&s) { result.push(WeekHealthSource{kind:"meal".into(),id,revision,start,end:start,wake_date:None,title:title.unwrap_or_else(||"饮食".into()),activity_type:None,slot,icon_key,segments:None}); }
    }
    result.sort_by(|a,b|(a.start,a.end,&a.id).cmp(&(b.start,b.end,&b.id)));
    Ok(result)
}

fn snapshot(tx: &Transaction, item_id: &str, live: bool) -> DomainResult<HealthPlanSnapshot> {
    let (action_id,kind,activity_type,health_kind,health_id,auto_match_enabled): (String,String,Option<String>,Option<String>,Option<String>,bool)=tx.query_row("SELECT action_id,kind,activity_type,health_kind,health_id,auto_match_enabled FROM productivity_item_health_plan WHERE item_id=?1",[item_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
    let invalid_source = if let (Some(k),Some(id))=(&health_kind,&health_id) { !sources(tx)?.iter().any(|s|&s.kind==k&&&s.id==id) } else {false};
    Ok(HealthPlanSnapshot{item:item_snapshot(tx,item_id,live)?,action:super::execution::apply_execution_state(action_snapshot(tx,&action_id,live)?),detail:HealthPlanDetail{kind,activity_type,health_kind,health_id,auto_match_enabled,invalid_source}})
}
fn checked(tx: &Transaction, item: &RevisionRef, action: &RevisionRef, live: bool) -> DomainResult<HealthPlanSnapshot> {
    let s = snapshot(tx,&item.id,live)?;
    check_revision(item.expected_revision,s.item.revision)?;
    if s.action.id != action.id || s.action.target_kind.as_deref()!=Some("item") || s.action.target_id.as_deref()!=Some(item.id.as_str()) { return Err(DomainError::invalid_patch("health plan Action/Item mismatch")); }
    check_revision(action.expected_revision,s.action.revision)?;
    let (_,ie)=load_item_row(tx,&item.id,live)?; guard_unknown(&ie)?;
    let (_,ae)=load_action_row(tx,&action.id,live)?; guard_unknown(&ae)?;
    super::validation::ensure_item_writable(tx,&item.id)?;
    if !s.action.intervals.is_empty() || s.action.session_id.is_some() { return Err(DomainError::invalid_patch("health plans cannot have Intervals or Session")); }
    Ok(s)
}
fn available(tx: &Transaction, kind: &str, id: &str, item: &str) -> DomainResult<()> {
    let used:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_health_plan p JOIN productivity_item i ON i.id=p.item_id WHERE p.health_kind=?1 AND p.health_id=?2 AND p.item_id<>?3 AND i.deleted_at_utc IS NULL)",params![kind,id,item],|r|r.get(0))?;
    if used { Err(DomainError::invalid_patch("Health source is already linked")) } else { Ok(()) }
}
fn bind(tx: &Transaction, s: &HealthPlanSnapshot, source: &WeekHealthSource) -> DomainResult<()> {
    if (s.detail.kind=="activity" && source.kind!="activity") || (s.detail.kind=="sleep" && !matches!(source.kind.as_str(),"sleep-night"|"nap")) { return Err(DomainError::invalid_patch("Health source kind differs")); }
    available(tx,&source.kind,&source.id,&s.item.id)?;
    if s.detail.health_kind.as_deref()==Some(source.kind.as_str())&&s.detail.health_id.as_deref()==Some(source.id.as_str())&&s.item.status=="完成"&&s.action.ended {return Ok(());}
    let now=utc_now();
    tx.execute("UPDATE productivity_item_health_plan SET health_kind=?1,health_id=?2 WHERE item_id=?3",params![source.kind,source.id,s.item.id])?;
    tx.execute("UPDATE productivity_item SET status='完成' WHERE id=?1",[&s.item.id])?;
    tx.execute("UPDATE productivity_action SET ended=1 WHERE id=?1",[&s.action.id])?;
    bump_item(tx,&s.item.id,&now)?; if !s.action.ended {bump_action(tx,&s.action.id,&now)?;}
    Ok(())
}
pub fn link(req: HealthPlanRequest) -> DomainResult<HealthPlanSnapshot> {
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let s=checked(tx,&req.item,&req.action,true)?;
        let reference=req.source.as_ref().ok_or_else(||DomainError::invalid_patch("Health source required"))?;
        let source=sources(tx)?.into_iter().find(|s|s.kind==reference.kind&&s.id==reference.id).ok_or_else(||DomainError::root_not_found("Health source unavailable"))?;
        check_revision(reference.expected_revision,source.revision)?;
        bind(tx,&s,&source)?; snapshot(tx,&s.item.id,true)
    }))
}
pub fn unlink(req: HealthPlanRequest) -> DomainResult<HealthPlanSnapshot> {
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let s=checked(tx,&req.item,&req.action,true)?; let now=utc_now();
        if s.detail.health_id.is_none()&&!s.detail.auto_match_enabled&&s.item.status=="进行中"&&!s.action.ended {return Ok(s);}
        tx.execute("UPDATE productivity_item_health_plan SET health_kind=NULL,health_id=NULL,auto_match_enabled=0 WHERE item_id=?1",[&s.item.id])?;
        tx.execute("UPDATE productivity_item SET status='进行中' WHERE id=?1",[&s.item.id])?;
        tx.execute("UPDATE productivity_action SET ended=0 WHERE id=?1",[&s.action.id])?;
        bump_item(tx,&s.item.id,&now)?; if s.action.ended {bump_action(tx,&s.action.id,&now)?;}
        snapshot(tx,&s.item.id,true)
    }))
}
pub fn list(req: WeekHealthRequest) -> DomainResult<WeekHealthResponse> {
    let start=instant(&req.start)?; let end=instant(&req.end)?;
    if start>=end{return Err(DomainError::invalid_patch("week range end must follow start"));}
    if req.include_activity_pauses && end.saturating_sub(start) > 32 * 86_400_000 {
        return Err(DomainError::invalid_patch("activity pause range exceeds 32 days"));
    }
    let (mut response, assets) = super::coordinator::with_strict_read(&req.expected_data_dir,|conn|{
        let Some(conn)=conn else {return Ok((WeekHealthResponse{plans:vec![],sources:vec![],catalog:None}, Vec::new()));};
        in_transaction(conn,|tx|{
            let mut stmt=tx.prepare("SELECT p.item_id FROM productivity_item_health_plan p JOIN productivity_item i ON i.id=p.item_id WHERE i.deleted_at_utc IS NULL ORDER BY p.item_id")?;
            let ids=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
            let plans=ids.iter().map(|id|snapshot(tx,id,true)).collect::<DomainResult<Vec<_>>>()?;
            let sources: Vec<WeekHealthSource>=sources(tx)?.into_iter().filter(|s|s.start<end && s.end>=start).collect();
            let mut assets = Vec::new();
            if req.include_activity_pauses {
                let mut asset_stmt = tx.prepare("SELECT relative_path FROM health_activity_asset WHERE activity_id=?1 AND kind='original_zip' AND status='ready' AND relative_path IS NOT NULL")?;
                for source in sources.iter().filter(|source| source.kind == "activity") {
                    let path: Option<String> = asset_stmt.query_row([&source.id], |row| row.get(0)).optional()?;
                    if let Some(path) = path { assets.push((source.id.clone(), path)); }
                }
            }
            Ok((WeekHealthResponse{plans,sources,catalog:super::classification::catalog_snapshot(tx)?}, assets))
        })
    })?;
    // Parse only visible source assets after releasing the Archive read transaction.
    // Missing assets are normal; malformed assets cannot hide the Health source.
    for (id, path) in assets {
        match super::activity_pauses::read_activity_pauses(&req.expected_data_dir, &path) {
            Ok(pauses) => if let Some(source) = response.sources.iter_mut().find(|s| s.kind == "activity" && s.id == id) {
                source.segments = Some(Value::Array(pauses.into_iter().map(|(start, end)| serde_json::json!({"start": start as f64 / 1000.0, "end": end as f64 / 1000.0})).collect()));
            },
            Err(error) => eprintln!("运动暂停区段读取失败: {error}"),
        }
    }
    Ok(response)
}

fn business_date(tx: &Transaction, instant: &str) -> DomainResult<String> {
    // Compare parsed instants, not ISO text: equivalent UTC strings can differ
    // in fractional precision exactly at a BusinessZone replacement boundary.
    let at=super::health_plan::instant(instant)?;
    let mut offset:String=tx.query_row("SELECT value FROM archive_meta WHERE key='base_timezone_offset'",[],|r|r.get(0))?;
    let mut stmt=tx.prepare("SELECT start_utc,end_utc,offset FROM timezone_replacement ORDER BY start_utc,id")?;
    for row in stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))? {
        let(start,end,candidate)=row?;
        if super::health_plan::instant(&start)?<=at&&at<super::health_plan::instant(&end)? {offset=candidate;break;}
    }
    let zone:FixedOffset=offset.parse().map_err(|_|DomainError::invalid_patch("invalid BusinessZone offset"))?;
    Ok(DateTime::parse_from_rfc3339(instant).map_err(|_|DomainError::invalid_patch("invalid planned end"))?.with_timezone(&zone).format("%Y-%m-%d").to_string())
}
pub fn reconcile(req: ReconcileHealthRequest) -> DomainResult<Vec<HealthPlanSnapshot>> {
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let all=sources(tx)?;
        let mut stmt=tx.prepare("SELECT p.item_id FROM productivity_item_health_plan p JOIN productivity_item i ON i.id=p.item_id WHERE p.kind='sleep' AND p.auto_match_enabled=1 AND p.health_id IS NULL AND i.deleted_at_utc IS NULL AND i.status='进行中'")?;
        let eligible=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        if eligible.iter().any(|id|!req.plans.iter().any(|r|&r.item.id==id)) || req.plans.iter().map(|r|&r.item.id).collect::<std::collections::HashSet<_>>().len()!=req.plans.len() {return Err(DomainError::revision_conflict("sleep plan candidate set changed"));}
        let mut plans=Vec::new();
        for r in &req.plans { let s=checked(tx,&r.item,&r.action,true)?; if s.detail.kind=="sleep"&&s.detail.auto_match_enabled&&s.detail.health_id.is_none()&&s.item.status=="进行中" { plans.push(s); } }
        // Validate the observed source revisions, then compute candidates again inside this transaction.
        for r in &req.sources { let s=all.iter().find(|s|s.kind==r.kind&&s.id==r.id).ok_or_else(||DomainError::revision_conflict("Health candidate disappeared"))?; check_revision(r.expected_revision,s.revision)?; }
        let mut candidates=Vec::new();
        for (i,p) in plans.iter().enumerate() {
            if let (Some(start),Some(end))=(&p.action.planned_start_at,&p.action.planned_end_at) {
                let date=business_date(tx,end)?;
                for s in &all { if s.kind=="sleep-night"&&s.wake_date.as_deref()==Some(date.as_str())&&instant(start)?<s.end&&instant(end)?>s.start&&available(tx,&s.kind,&s.id,&p.item.id).is_ok() { candidates.push((i,s)); } }
            }
        }
        let mut changed=Vec::new();
        for (i,s) in &candidates { if candidates.iter().filter(|(j,_)|j==i).count()==1&&candidates.iter().filter(|(_,other)|other.id==s.id).count()==1 {
            if !req.sources.iter().any(|r|r.id==s.id&&r.kind==s.kind&&r.expected_revision==s.revision) {continue;}
            bind(tx,&plans[*i],s)?; changed.push(snapshot(tx,&plans[*i].item.id,true)?);
        } }
        Ok(changed)
    }))
}

/// Generic lifecycle paths must not mutate one member of the managed pair.
pub(crate) fn guard_item(tx: &Transaction, id: &str) -> DomainResult<()> {
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM productivity_item_health_plan WHERE item_id=?1)",[id],|r|r.get(0))?;
    if exists { Err(DomainError::invalid_patch("health plan requires its aggregate command")) } else {Ok(())}
}
pub(crate) fn guard_action(tx: &Transaction, id: &str) -> DomainResult<()> {
    let item:Option<String>=tx.query_row("SELECT target_id FROM productivity_action WHERE id=?1 AND target_kind='item'",[id],|r|r.get(0)).optional()?.flatten();
    if let Some(item)=item { guard_item(tx,&item)?; }
    Ok(())
}

pub fn mutate(req: HealthPlanRequest) -> DomainResult<HealthPlanSnapshot> {
    with_write_expected(&req.expected_data_dir,|conn|in_transaction(conn,|tx|{
        let restoring=req.operation.as_deref()==Some("restore");
        let s=checked(tx,&req.item,&req.action,!restoring)?; let now=utc_now();
        let mut item_changed=true; let mut action_changed=true;
        match req.operation.as_deref().unwrap_or("update") {
            "update" => { let start=req.start.as_ref().ok_or_else(||DomainError::invalid_patch("start required"))?; let end=req.end.as_ref().ok_or_else(||DomainError::invalid_patch("end required"))?; range(start,end)?; item_changed=false; action_changed=s.action.planned_start_at.as_deref()!=Some(start.as_str())||s.action.planned_end_at.as_deref()!=Some(end.as_str()); if action_changed {tx.execute("UPDATE productivity_action SET planned_start_at=?1,planned_end_at=?2 WHERE id=?3",params![start,end,s.action.id])?;} }
            "cancel" if s.detail.kind=="activity" => { if s.detail.health_id.is_some() {return Err(DomainError::invalid_patch("unlink before cancelling"));} action_changed=false; item_changed=s.item.status!="取消"; if item_changed {tx.execute("UPDATE productivity_item SET status='取消' WHERE id=?1",[&s.item.id])?;} }
            "delete" => { let batch=new_uuid(); remove_item_from_order(tx,&s.item.id,&now)?; tx.execute("UPDATE productivity_item SET deleted_at_utc=?1,deletion_batch_id=?2 WHERE id=?3",params![now,batch,s.item.id])?; tx.execute("UPDATE productivity_action SET deleted_at_utc=?1,deletion_batch_id=?2 WHERE id=?3",params![now,batch,s.action.id])?; tx.execute("UPDATE productivity_item_health_plan SET deleted_at_utc=?1,deletion_batch_id=?2 WHERE item_id=?3",params![now,batch,s.item.id])?; }
            "restore" => {
                let same:bool=tx.query_row("SELECT i.deleted_at_utc IS NOT NULL AND a.deleted_at_utc IS NOT NULL AND p.deleted_at_utc IS NOT NULL AND i.deletion_batch_id=a.deletion_batch_id AND i.deletion_batch_id=p.deletion_batch_id FROM productivity_item i JOIN productivity_item_health_plan p ON p.item_id=i.id JOIN productivity_action a ON a.id=p.action_id WHERE i.id=?1",[&s.item.id],|r|r.get(0))?;
                if !same {return Err(DomainError::delete_batch_mismatch());}
                if let (Some(k),Some(id))=(&s.detail.health_kind,&s.detail.health_id) {available(tx,k,id,&s.item.id)?;}
                tx.execute("UPDATE productivity_item SET deleted_at_utc=NULL,deletion_batch_id=NULL WHERE id=?1",[&s.item.id])?;
                tx.execute("UPDATE productivity_action SET deleted_at_utc=NULL,deletion_batch_id=NULL WHERE id=?1",[&s.action.id])?;
                tx.execute("UPDATE productivity_item_health_plan SET deleted_at_utc=NULL,deletion_batch_id=NULL WHERE item_id=?1",[&s.item.id])?;
                append_item_to_order(tx,&s.item.id,&now)?;
            }
            _ => return Err(DomainError::invalid_patch("invalid health plan operation")),
        }
        if item_changed {bump_item(tx,&s.item.id,&now)?;} if action_changed {bump_action(tx,&s.action.id,&now)?;}
        snapshot(tx,&s.item.id,false)
    }))
}
