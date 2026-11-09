use rusqlite::{params, OptionalExtension, Transaction};

use crate::finance_v2_domain::Id;

use super::{accounts::{require_active_account, require_active_via}, StoreError};

pub fn append_context_version(tx:&Transaction<'_>, value:&SourceContext, expected_revision:Option<u64>, at_utc_us:i64)->Result<u64,StoreError>{
    if value.label.trim().is_empty()||value.provider.trim().is_empty()||value.scope.trim().is_empty()||value.date_semantics.trim().is_empty(){return Err(StoreError::InvalidDomainValue)}
    let current=tx.query_row("SELECT revision FROM finance_v2_source_context_current WHERE id=?1",[value.id.as_str()],|r|r.get::<_,i64>(0)).optional()?;
    let expected=expected_revision.map(i64::try_from).transpose().map_err(|_|StoreError::InvalidDomainValue)?;
    let revision=i64::try_from(value.revision).map_err(|_|StoreError::InvalidDomainValue)?;
    match(current,expected){(None,None) if revision==1=>{},(Some(now),Some(want)) if now==want&&want.checked_add(1)==Some(revision)=>{},_=>return Err(StoreError::StaleRevision)}
    tx.execute("INSERT INTO finance_v2_source_context_versions(id,revision,label,provider,scope,date_semantics,active,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![value.id.as_str(),revision,value.label,value.provider,value.scope,value.date_semantics,if value.active{1_i64}else{0_i64},at_utc_us])?;
    if current.is_some(){let n=tx.execute("UPDATE finance_v2_source_context_current SET revision=?2 WHERE id=?1 AND revision=?3",params![value.id.as_str(),revision,expected])?;if n!=1{return Err(StoreError::StaleRevision)}}else{tx.execute("INSERT INTO finance_v2_source_context_current(id,revision) VALUES (?1,?2)",params![value.id.as_str(),revision])?;}
    tx.execute("UPDATE finance_v2_source_context_state SET revision=revision+1 WHERE singleton=1",[])?;
    Ok(value.revision)
}

pub fn active_context_revision(tx:&Transaction<'_>,id:&Id)->Result<Option<u64>,StoreError>{
    let row=tx.query_row("SELECT v.revision,v.active FROM finance_v2_source_context_current c JOIN finance_v2_source_context_versions v USING(id,revision) WHERE c.id=?1",[id.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?))).optional()?;
    row.map(|(revision,active)|if active==1{u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)}else{Err(StoreError::InvalidDomainValue)}).transpose()
}

pub fn read_context_version(tx:&Transaction<'_>,id:&Id,revision:u64)->Result<Option<SourceContext>,StoreError>{
    let rev=i64::try_from(revision).map_err(|_|StoreError::InvalidDomainValue)?;
    let row=tx.query_row("SELECT label,provider,scope,date_semantics,active FROM finance_v2_source_context_versions WHERE id=?1 AND revision=?2",rusqlite::params![id.as_str(),rev],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?))).optional()?;
    row.map(|(label,provider,scope,date_semantics,active)|Ok(SourceContext{id:id.clone(),revision,label,provider,scope,date_semantics,active:active==1})).transpose()
}

pub fn context_history(tx:&Transaction<'_>,id:&Id)->Result<Vec<SourceContext>,StoreError>{
    let mut stmt=tx.prepare("SELECT revision FROM finance_v2_source_context_versions WHERE id=?1 ORDER BY revision")?;
    let rows=stmt.query_map([id.as_str()],|r|r.get::<_,i64>(0))?;let mut out=Vec::new();
    for row in rows{let revision=u64::try_from(row?).map_err(|_|StoreError::IncompatibleSchema)?;out.push(read_context_version(tx,id,revision)?.ok_or(StoreError::IncompatibleSchema)?);}
    Ok(out)
}

pub fn list_contexts(tx:&Transaction<'_>)->Result<(u64,Vec<SourceContext>),StoreError>{
    let global:i64=tx.query_row("SELECT revision FROM finance_v2_source_context_state WHERE singleton=1",[],|r|r.get(0))?;
    let mut stmt=tx.prepare("SELECT v.id,v.revision,v.label,v.provider,v.scope,v.date_semantics,v.active FROM finance_v2_source_context_current c JOIN finance_v2_source_context_versions v USING(id,revision) ORDER BY v.provider,v.label,v.id")?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,i64>(6)?)))?;
    let mut out=Vec::new();for row in rows{let(id,revision,label,provider,scope,date_semantics,active)=row?;out.push(SourceContext{id:Id::parse(id).map_err(|_|StoreError::IncompatibleSchema)?,revision:u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?,label,provider,scope,date_semantics,active:active==1});}
    Ok((u64::try_from(global).map_err(|_|StoreError::IncompatibleSchema)?,out))
}

fn require_active_context_revision(tx:&Transaction<'_>,id:&Id,revision:u64)->Result<(),StoreError>{
    if active_context_revision(tx,id)?==Some(revision){Ok(())}else{Err(StoreError::StaleRevision)}
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceArtifact {
    pub id: Id,
    pub sha256: String,
    pub byte_length: u64,
    pub media_type: String,
    /// POSIX-style path relative to the caller's already-validated isolated root.
    pub relative_path: String,
    pub context_id: Id,
    pub context_revision: u64,
    pub binding_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceContext {
    pub id: Id,
    pub revision: u64,
    pub label: String,
    pub provider: String,
    pub scope: String,
    pub date_semantics: String,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBinding {
    pub id: Id,
    pub revision: u64,
    pub context_id: Id,
    pub context_revision: u64,
    pub profile_id: String,
    pub profile_revision: String,
    pub field_alias: String,
    pub source_hint: Option<String>,
    pub account_id: Option<Id>,
    pub via_id: Option<Id>,
    pub active: bool,
}

pub fn register_artifact(
    tx: &Transaction<'_>,
    artifact: &SourceArtifact,
    created_at_utc_us: i64,
) -> Result<(), StoreError> {
    if artifact.sha256.len() != 64
        || !artifact.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || artifact.media_type.trim().is_empty()
        || artifact.context_revision == 0
        || !valid_relative_path(&artifact.relative_path)
    {
        return Err(StoreError::InvalidDomainValue);
    }
    require_active_context_revision(tx,&artifact.context_id,artifact.context_revision)?;
    let byte_length = i64::try_from(artifact.byte_length).map_err(|_| StoreError::InvalidDomainValue)?;
    tx.execute(
        "INSERT INTO finance_v2_source_artifacts(id,sha256,byte_length,media_type,relative_path,source_context_id,source_context_revision,binding_revision,created_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![artifact.id.as_str(), artifact.sha256, byte_length, artifact.media_type, artifact.relative_path, artifact.context_id.as_str(), i64::try_from(artifact.context_revision).map_err(|_| StoreError::InvalidDomainValue)?, i64::try_from(artifact.binding_revision).map_err(|_| StoreError::InvalidDomainValue)?, created_at_utc_us],
    )?;
    Ok(())
}

pub fn find_artifact(tx: &Transaction<'_>, id: &Id) -> Result<Option<SourceArtifact>, StoreError> {
    let row = tx.query_row(
        "SELECT sha256,byte_length,media_type,relative_path,source_context_id,source_context_revision,binding_revision FROM finance_v2_source_artifacts WHERE id=?1",
        [id.as_str()],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, i64>(5)?, row.get::<_, i64>(6)?)),
    ).optional()?;
    row.map(|(sha256, length, media_type, relative_path, context_id, context_revision,binding_revision)| {
        Ok(SourceArtifact { id: id.clone(), sha256, byte_length: u64::try_from(length).map_err(|_| StoreError::IncompatibleSchema)?, media_type, relative_path, context_id: Id::parse(context_id).map_err(|_| StoreError::IncompatibleSchema)?, context_revision: u64::try_from(context_revision).map_err(|_| StoreError::IncompatibleSchema)?, binding_revision:u64::try_from(binding_revision).map_err(|_|StoreError::IncompatibleSchema)? })
    }).transpose()
}

pub fn append_binding_version(
    tx: &Transaction<'_>,
    binding: &SourceBinding,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
) -> Result<u64, StoreError> {
    if binding.context_revision == 0
        || binding.profile_id.trim().is_empty()
        || binding.profile_revision.trim().is_empty()
        || binding.field_alias.trim().is_empty()
        || (binding.field_alias.starts_with("artifact_") && binding.source_hint.as_deref().is_some_and(|v| !v.is_empty()))
        || (!binding.field_alias.starts_with("artifact_") && binding.source_hint.as_ref().map_or(true, |v| v.trim().is_empty()))
        || (binding.account_id.is_none() && binding.via_id.is_none())
        || binding.revision == 0
    {
        return Err(StoreError::InvalidDomainValue);
    }
    if binding.context_revision==0 || active_context_revision(tx,&binding.context_id)?.map_or(true,|current|binding.context_revision>current){return Err(StoreError::StaleRevision)}
    if let Some(account) = &binding.account_id {
        require_active_account(tx, account.as_str())?;
    }
    if let Some(via) = &binding.via_id {
        require_active_via(tx, via.as_str())?;
    }
    let current = tx.query_row(
        "SELECT revision FROM finance_v2_source_binding_current WHERE id=?1",
        [binding.id.as_str()],
        |row| row.get::<_, i64>(0),
    ).optional()?;
    let expected = expected_revision.map(i64::try_from).transpose().map_err(|_| StoreError::InvalidDomainValue)?;
    let revision = i64::try_from(binding.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    match (current, expected) {
        (None, None) if revision == 1 => {},
        (Some(now), Some(want)) if now == want && want.checked_add(1) == Some(revision) => {},
        _ => return Err(StoreError::StaleRevision),
    }
    if binding.active {
        let occupied: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM finance_v2_source_binding_current c JOIN finance_v2_source_binding_versions v USING(id,revision) WHERE c.id<>?1 AND v.active=1 AND v.source_context_id=?2 AND v.profile_id=?3 AND v.profile_revision=?4 AND v.field_alias=?5 AND v.source_hint=?6 AND v.account_id IS ?7 AND v.via_id IS ?8)",
            params![binding.id.as_str(), binding.context_id.as_str(), binding.profile_id, binding.profile_revision, binding.field_alias, binding.source_hint.as_deref().unwrap_or(""), binding.account_id.as_ref().map(Id::as_str), binding.via_id.as_ref().map(Id::as_str)],
            |row| row.get(0),
        )?;
        if occupied { return Err(StoreError::InvalidDomainValue); }
    }
    tx.execute(
        "INSERT INTO finance_v2_source_binding_versions(id,revision,source_context_id,source_context_revision,profile_id,profile_revision,field_alias,source_hint,account_id,via_id,active,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![binding.id.as_str(), revision, binding.context_id.as_str(), i64::try_from(binding.context_revision).map_err(|_|StoreError::InvalidDomainValue)?, binding.profile_id, binding.profile_revision, binding.field_alias, binding.source_hint.as_deref().unwrap_or(""), binding.account_id.as_ref().map(Id::as_str), binding.via_id.as_ref().map(Id::as_str), if binding.active { 1_i64 } else { 0_i64 }, recorded_at_utc_us],
    )?;
    if current.is_some() {
        let changed = tx.execute("UPDATE finance_v2_source_binding_current SET revision=?2 WHERE id=?1 AND revision=?3", params![binding.id.as_str(), revision, expected])?;
        if changed != 1 { return Err(StoreError::StaleRevision); }
    } else {
        tx.execute("INSERT INTO finance_v2_source_binding_current(id,revision) VALUES (?1,?2)", params![binding.id.as_str(), revision])?;
    }
    tx.execute("UPDATE finance_v2_binding_state SET revision=revision+1 WHERE singleton=1", [])?;
    Ok(binding.revision)
}

pub fn current_binding_revision(tx: &Transaction<'_>) -> Result<u64, StoreError> {
    let value: i64 = tx.query_row("SELECT revision FROM finance_v2_binding_state WHERE singleton=1", [], |row| row.get(0))?;
    u64::try_from(value).map_err(|_| StoreError::IncompatibleSchema)
}

pub fn active_bindings(
    tx: &Transaction<'_>,
    context_id: &Id,
    context_revision: u64,
    profile_id: &str,
    profile_revision: &str,
) -> Result<(u64, Vec<SourceBinding>), StoreError> {
    require_active_context_revision(tx,context_id,context_revision)?;
    let snapshot_revision = current_binding_revision(tx)?;
    let mut statement = tx.prepare(
        "SELECT v.id,v.revision,v.source_context_id,v.source_context_revision,v.profile_id,v.profile_revision,v.field_alias,v.source_hint,v.account_id,v.via_id,v.active FROM finance_v2_source_binding_current c JOIN finance_v2_source_binding_versions v USING(id,revision) WHERE v.active=1 AND v.source_context_id=?1 AND v.profile_id=?2 AND v.profile_revision=?3 ORDER BY v.field_alias,v.source_hint,v.id",
    )?;
    let rows = statement.query_map(params![context_id.as_str(), profile_id, profile_revision], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, Option<String>>(8)?, row.get::<_, Option<String>>(9)?, row.get::<_, i64>(10)?))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (id, revision, context, context_revision, profile, profile_rev, alias, source_hint, account, via, active) = row?;
        result.push(SourceBinding {
            id: Id::parse(id).map_err(|_| StoreError::IncompatibleSchema)?,
            revision: u64::try_from(revision).map_err(|_| StoreError::IncompatibleSchema)?,
            context_id: Id::parse(context).map_err(|_|StoreError::IncompatibleSchema)?, context_revision:u64::try_from(context_revision).map_err(|_|StoreError::IncompatibleSchema)?, profile_id: profile, profile_revision: profile_rev, field_alias: alias, source_hint: if source_hint.is_empty(){None}else{Some(source_hint)},
            account_id: account.map(Id::parse).transpose().map_err(|_| StoreError::IncompatibleSchema)?,
            via_id: via.map(Id::parse).transpose().map_err(|_| StoreError::IncompatibleSchema)?,
            active: active == 1,
        });
    }
    Ok((snapshot_revision, result))
}

pub fn binding_history(tx:&Transaction<'_>,id:&Id)->Result<Vec<SourceBinding>,StoreError>{
    let mut stmt=tx.prepare("SELECT revision,source_context_id,source_context_revision,profile_id,profile_revision,field_alias,source_hint,account_id,via_id,active FROM finance_v2_source_binding_versions WHERE id=?1 ORDER BY revision")?;
    let rows=stmt.query_map([id.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,i64>(9)?)))?;
    let mut result=Vec::new();
    for row in rows {
        let (revision,context,context_revision,profile,profile_revision,alias,source_hint,account,via,active)=row?;
        result.push(SourceBinding{id:id.clone(),revision:u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?,context_id:Id::parse(context).map_err(|_|StoreError::IncompatibleSchema)?,context_revision:u64::try_from(context_revision).map_err(|_|StoreError::IncompatibleSchema)?,profile_id:profile,profile_revision,field_alias:alias,source_hint:if source_hint.is_empty(){None}else{Some(source_hint)},account_id:account.map(Id::parse).transpose().map_err(|_|StoreError::IncompatibleSchema)?,via_id:via.map(Id::parse).transpose().map_err(|_|StoreError::IncompatibleSchema)?,active:active==1});
    }
    Ok(result)
}

fn valid_relative_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains(':') {
        return false;
    }
    path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}
