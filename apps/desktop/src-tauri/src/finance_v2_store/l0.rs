use rusqlite::{params, OptionalExtension, Transaction};

use crate::finance_v2_domain::{Amount, BusinessDate, BusinessTime, CommodityCode, FactStatus, Id, L0Fact, Provenance, Quantity};

use super::StoreError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum L0ChangeOrigin { CreatedManual, CreatedImported, ManualAmend, Deleted, Restored, Refined }

impl L0ChangeOrigin {
    fn as_str(self) -> &'static str { match self { Self::CreatedManual=>"created_manual",Self::CreatedImported=>"created_imported",Self::ManualAmend=>"manual_amend",Self::Deleted=>"deleted",Self::Restored=>"restored",Self::Refined=>"refined" } }
}

#[derive(Clone, Debug)]
pub struct L0HistoryEntry { pub fact:L0Fact, pub change_origin:L0ChangeOrigin, pub recorded_at_utc_us:i64 }

pub fn append_l0_version(
    tx: &Transaction<'_>,
    fact: &L0Fact,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
    change_origin: L0ChangeOrigin,
) -> Result<(), StoreError> {
    fact.validate().map_err(|_| StoreError::InvalidDomainValue)?;
    let revision = i64::try_from(fact.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let expected = expected_revision
        .map(i64::try_from)
        .transpose()
        .map_err(|_| StoreError::InvalidDomainValue)?;
    let current: Option<i64> = tx
        .query_row(
            "SELECT revision FROM finance_v2_l0_current WHERE id=?1",
            [fact.id.as_str()],
            |row| row.get(0),
        )
        .optional()?;
    match (current, expected) {
        (None, None) if revision == 1 => {}
        (Some(current_revision), Some(expected_revision))
            if current_revision == expected_revision
                && expected_revision.checked_add(1) == Some(revision) => {}
        _ => return Err(StoreError::StaleRevision),
    }
    if let Some(current_revision)=current {
        let current_fact=read_l0_version(tx,&fact.id,u64::try_from(current_revision).map_err(|_|StoreError::IncompatibleSchema)?)?.ok_or(StoreError::IncompatibleSchema)?;
        if current_fact.provenance!=fact.provenance{return Err(StoreError::InvalidDomainValue)}
    }
    let origin_valid=match (expected.is_none(),fact.status,change_origin,&fact.provenance){
        (true,FactStatus::Active,L0ChangeOrigin::CreatedManual,Provenance::Manual{..})=>true,
        (true,FactStatus::Active,L0ChangeOrigin::CreatedImported,Provenance::Imported{..})=>true,
        (false,FactStatus::Deleted,L0ChangeOrigin::Deleted,_)=>true,
        (false,FactStatus::Refined,L0ChangeOrigin::Refined,_)=>true,
        (false,FactStatus::Active,L0ChangeOrigin::ManualAmend,_)=>true,
        (false,FactStatus::Active,L0ChangeOrigin::Restored,_)=>true,
        _=>false,
    };
    if !origin_valid{return Err(StoreError::InvalidDomainValue)}

    let fact_is_active = fact.status == FactStatus::Active;
    require_account_reference(tx, fact.positive_account_id.as_str(), fact_is_active)?;
    require_account_reference(tx, fact.negative_account_id.as_str(), fact_is_active)?;
    if let Provenance::Imported { evidence_ids } = &fact.provenance {
        if evidence_ids.is_empty() {
            return Err(StoreError::InvalidDomainValue);
        }
        let mut seen = std::collections::HashSet::new();
        for evidence_id in evidence_ids {
            if !seen.insert(evidence_id.as_str()) {
                return Err(StoreError::InvalidDomainValue);
            }
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM finance_v2_evidence WHERE id=?1)",
                [evidence_id.as_str()],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(StoreError::MissingReference);
            }
        }
    }
    if let Some(via_id) = &fact.via_id {
        require_via_reference(tx, via_id.as_str(), fact_is_active)?;
        let binding_active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM finance_v2_account_via_history h WHERE h.via_id=?1 AND h.active=1 AND h.revision=(SELECT MAX(h2.revision) FROM finance_v2_account_via_history h2 WHERE h2.account_id=h.account_id AND h2.via_id=h.via_id) AND h.account_id IN (?2,?3))",
            params![via_id.as_str(), fact.positive_account_id.as_str(), fact.negative_account_id.as_str()],
            |row| row.get(0),
        )?;
        if fact_is_active && !binding_active {
            return Err(StoreError::InactiveReference);
        }
    }

    let (time_kind, source_date, utc_micros) = match &fact.business_time {
        BusinessTime::Date { source_date } => ("date", Some(source_date.as_string()), None),
        BusinessTime::Instant { utc_micros, source_date } => (
            "instant",
            source_date.map(|date| date.as_string()),
            Some(*utc_micros),
        ),
    };
    let (provenance_kind, provenance_payload) = encode_provenance(&fact.provenance)?;
    let status = match fact.status {
        FactStatus::Active => "active",
        FactStatus::Deleted => "deleted",
        FactStatus::Refined => "refined",
    };
    tx.execute(
        "INSERT INTO finance_v2_l0_versions(id,revision,effective_date,business_time_kind,source_date,occurred_at_utc_us,positive_account_id,positive_coefficient,positive_scale,positive_commodity,negative_account_id,negative_coefficient,negative_scale,negative_commodity,via_id,title,notes,provenance_kind,provenance_payload,change_origin,status,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        params![
            fact.id.as_str(), revision, fact.effective_date.as_string(), time_kind,
            source_date, utc_micros, fact.positive_account_id.as_str(),
            fact.positive.amount.coefficient().to_string(), fact.positive.amount.scale(),
            fact.positive.commodity.as_str(), fact.negative_account_id.as_str(),
            fact.negative.amount.coefficient().to_string(), fact.negative.amount.scale(),
            fact.negative.commodity.as_str(), fact.via_id.as_ref().map(|value| value.as_str()),
            fact.title, fact.notes, provenance_kind, provenance_payload, change_origin.as_str(), status,
            recorded_at_utc_us,
        ],
    )?;
    if expected.is_none() {
        tx.execute(
            "INSERT INTO finance_v2_l0_current(id,revision) VALUES (?1,?2)",
            params![fact.id.as_str(), revision],
        )?;
    } else {
        let updated = tx.execute(
            "UPDATE finance_v2_l0_current SET revision=?2 WHERE id=?1 AND revision=?3",
            params![fact.id.as_str(), revision, expected],
        )?;
        if updated != 1 {
            return Err(StoreError::StaleRevision);
        }
    }
    tx.execute(
        "UPDATE finance_v2_accounts SET ever_used=1 WHERE id IN (?1,?2) AND ever_used=0",
        params![fact.positive_account_id.as_str(), fact.negative_account_id.as_str()],
    )?;
    Ok(())
}

fn require_account_reference(tx:&Transaction<'_>,id:&str,require_active:bool)->Result<(),StoreError>{
    let value:Option<bool>=tx.query_row("SELECT active=1 FROM finance_v2_accounts WHERE id=?1",[id],|r|r.get(0)).optional()?;
    match value{None=>Err(StoreError::MissingReference),Some(false) if require_active=>Err(StoreError::InactiveReference),Some(_)=>Ok(())}
}

fn require_via_reference(tx:&Transaction<'_>,id:&str,require_active:bool)->Result<(),StoreError>{
    let value:Option<bool>=tx.query_row("SELECT active=1 FROM finance_v2_vias WHERE id=?1",[id],|r|r.get(0)).optional()?;
    match value{None=>Err(StoreError::MissingReference),Some(false) if require_active=>Err(StoreError::InactiveReference),Some(_)=>Ok(())}
}

pub fn read_l0_version(tx: &Transaction<'_>, id: &Id, revision: u64) -> Result<Option<L0Fact>, StoreError> {
    let revision_db = i64::try_from(revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let row = tx.query_row(
        "SELECT effective_date,business_time_kind,source_date,occurred_at_utc_us,positive_account_id,positive_coefficient,positive_scale,positive_commodity,negative_account_id,negative_coefficient,negative_scale,negative_commodity,via_id,title,notes,provenance_kind,provenance_payload,status FROM finance_v2_l0_versions WHERE id=?1 AND revision=?2",
        params![id.as_str(), revision_db],
        |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<i64>>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,i64>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?,r.get::<_,String>(9)?,r.get::<_,i64>(10)?,r.get::<_,String>(11)?,r.get::<_,Option<String>>(12)?,r.get::<_,String>(13)?,r.get::<_,String>(14)?,r.get::<_,String>(15)?,r.get::<_,String>(16)?,r.get::<_,String>(17)?)),
    ).optional()?;
    let Some((effective, kind, source_date, utc, pos_id, pos_coeff, pos_scale, pos_commodity, neg_id, neg_coeff, neg_scale, neg_commodity, via, title, notes, provenance_kind, provenance_payload, status)) = row else { return Ok(None); };
    let parse_domain = || -> Result<L0Fact, StoreError> {
        let effective_date = BusinessDate::parse(&effective).map_err(|_| StoreError::IncompatibleSchema)?;
        let source = source_date.map(|v| BusinessDate::parse(&v)).transpose().map_err(|_| StoreError::IncompatibleSchema)?;
        let business_time = match kind.as_str() {
            "date" => BusinessTime::Date { source_date: source.ok_or(StoreError::IncompatibleSchema)? },
            "instant" => BusinessTime::Instant { utc_micros: utc.ok_or(StoreError::IncompatibleSchema)?, source_date: source },
            _ => return Err(StoreError::IncompatibleSchema),
        };
        let quantity = |coefficient: String, scale: i64, commodity: String| -> Result<Quantity, StoreError> {
            let coefficient = coefficient.parse::<i128>().map_err(|_| StoreError::IncompatibleSchema)?;
            let scale = u8::try_from(scale).map_err(|_| StoreError::IncompatibleSchema)?;
            let amount = Amount::new(coefficient, scale).map_err(|_| StoreError::IncompatibleSchema)?;
            let commodity = CommodityCode::parse(commodity).map_err(|_| StoreError::IncompatibleSchema)?;
            Ok(Quantity::new(amount, commodity))
        };
        let provenance: Provenance = match provenance_kind.as_str() {
            "manual" => {
                let value: serde_json::Value = serde_json::from_str(&provenance_payload).map_err(|_| StoreError::IncompatibleSchema)?;
                Provenance::Manual { created_at_utc_micros: value.get("created_at_utc_micros").and_then(serde_json::Value::as_i64).ok_or(StoreError::IncompatibleSchema)? }
            }
            "imported" => {
                let value: serde_json::Value = serde_json::from_str(&provenance_payload).map_err(|_| StoreError::IncompatibleSchema)?;
                let ids = value.get("evidence_ids").and_then(serde_json::Value::as_array).ok_or(StoreError::IncompatibleSchema)?.iter().map(|v| {
                    let s = v.as_str().ok_or(StoreError::IncompatibleSchema)?;
                    Id::parse(s.to_owned()).map_err(|_| StoreError::IncompatibleSchema)
                }).collect::<Result<Vec<_>,_>>()?;
                Provenance::Imported { evidence_ids: ids }
            }
            _ => return Err(StoreError::IncompatibleSchema),
        };
        let status = match status.as_str() { "active" => FactStatus::Active, "deleted" => FactStatus::Deleted, "refined" => FactStatus::Refined, _ => return Err(StoreError::IncompatibleSchema) };
        let fact = L0Fact {
            id: id.clone(), revision, status, effective_date, business_time,
            positive_account_id: Id::parse(pos_id).map_err(|_| StoreError::IncompatibleSchema)?,
            positive: quantity(pos_coeff,pos_scale,pos_commodity)?,
            negative_account_id: Id::parse(neg_id).map_err(|_| StoreError::IncompatibleSchema)?,
            negative: quantity(neg_coeff,neg_scale,neg_commodity)?,
            via_id: via.map(Id::parse).transpose().map_err(|_| StoreError::IncompatibleSchema)?,
            title, notes, provenance,
        };
        fact.validate().map_err(|_| StoreError::IncompatibleSchema)?;
        Ok(fact)
    };
    parse_domain().map(Some)
}

pub fn read_current_l0(tx: &Transaction<'_>, id: &Id) -> Result<Option<L0Fact>, StoreError> {
    let revision: Option<i64> = tx.query_row("SELECT revision FROM finance_v2_l0_current WHERE id=?1", [id.as_str()], |r| r.get(0)).optional()?;
    match revision { Some(v) => read_l0_version(tx,id,u64::try_from(v).map_err(|_| StoreError::IncompatibleSchema)?), None => Ok(None) }
}

pub fn read_l0_history(tx: &Transaction<'_>, id: &Id) -> Result<Vec<L0Fact>, StoreError> {
    let mut stmt = tx.prepare("SELECT revision FROM finance_v2_l0_versions WHERE id=?1 ORDER BY revision")?;
    let rows = stmt.query_map([id.as_str()], |r| r.get::<_,i64>(0))?;
    let mut result = Vec::new();
    for row in rows { let rev = u64::try_from(row?).map_err(|_| StoreError::IncompatibleSchema)?; result.push(read_l0_version(tx,id,rev)?.ok_or(StoreError::IncompatibleSchema)?); }
    Ok(result)
}

pub fn read_deleted_current_facts(tx:&Transaction<'_>)->Result<Vec<L0Fact>,StoreError>{
    let mut stmt=tx.prepare("SELECT c.id,c.revision FROM finance_v2_l0_current c JOIN finance_v2_l0_versions v USING(id,revision) WHERE v.status='deleted' ORDER BY c.id")?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?;
    let mut out=Vec::new();
    for row in rows{let(id,revision)=row?;let id=Id::parse(id).map_err(|_|StoreError::IncompatibleSchema)?;out.push(read_l0_version(tx,&id,u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?)?.ok_or(StoreError::IncompatibleSchema)?);}
    Ok(out)
}

pub fn read_l0_history_entries(tx:&Transaction<'_>,id:&Id)->Result<Vec<L0HistoryEntry>,StoreError>{
    let mut stmt=tx.prepare("SELECT revision,change_origin,recorded_at_utc_us FROM finance_v2_l0_versions WHERE id=?1 ORDER BY revision")?;
    let rows=stmt.query_map([id.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?;
    let mut out=Vec::new();
    for row in rows { let (revision,origin,recorded)=row?; let revision=u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?; let change_origin=match origin.as_str(){"created_manual"=>L0ChangeOrigin::CreatedManual,"created_imported"=>L0ChangeOrigin::CreatedImported,"manual_amend"=>L0ChangeOrigin::ManualAmend,"deleted"=>L0ChangeOrigin::Deleted,"restored"=>L0ChangeOrigin::Restored,"refined"=>L0ChangeOrigin::Refined,_=>return Err(StoreError::IncompatibleSchema)}; out.push(L0HistoryEntry{fact:read_l0_version(tx,id,revision)?.ok_or(StoreError::IncompatibleSchema)?,change_origin,recorded_at_utc_us:recorded}); }
    Ok(out)
}

/// Required immediately before committing an imported fact or its amendment.
/// Every referenced occurrence must have an active link to this exact revision
/// and the observed account must be one of the fact's two endpoints.
pub fn validate_imported_provenance_links(tx:&Transaction<'_>,fact:&L0Fact)->Result<(),StoreError>{
    let Provenance::Imported{evidence_ids}=&fact.provenance else{return Ok(())};
    if evidence_ids.is_empty(){return Err(StoreError::InvalidDomainValue)}
    for evidence in evidence_ids {
        let linked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.evidence_id=?1 AND c.status='active' AND h.status='active' AND h.leaf_l0_id=?2 AND h.leaf_l0_revision=?3 AND h.observed_account_id IN (?4,?5))",params![evidence.as_str(),fact.id.as_str(),i64::try_from(fact.revision).map_err(|_|StoreError::InvalidDomainValue)?,fact.positive_account_id.as_str(),fact.negative_account_id.as_str()],|r|r.get(0))?;
        if !linked{return Err(StoreError::InvalidEvidenceAllocation)}
    }
    Ok(())
}

/// Commit-wide defensive gate: no active imported current fact may reach a
/// receipt without its full exact-revision endpoint evidence links.
pub fn validate_all_active_imported_links(tx:&Transaction<'_>)->Result<(),StoreError>{
    let mut stmt=tx.prepare("SELECT c.id,c.revision FROM finance_v2_l0_current c JOIN finance_v2_l0_versions v USING(id,revision) WHERE v.status='active' AND v.provenance_kind='imported' ORDER BY c.id")?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?;
    let mut facts=Vec::new();for row in rows{facts.push(row?)}drop(stmt);
    for (raw_id,raw_revision) in facts{
        let id=Id::parse(raw_id).map_err(|_|StoreError::IncompatibleSchema)?;
        let revision=u64::try_from(raw_revision).map_err(|_|StoreError::IncompatibleSchema)?;
        let fact=read_l0_version(tx,&id,revision)?.ok_or(StoreError::IncompatibleSchema)?;
        validate_imported_provenance_links(tx,&fact)?;
    }
    Ok(())
}

pub fn restore_l0_version(tx: &Transaction<'_>, id: &Id, source_revision: u64, expected_current_revision: u64, recorded_at_utc_us: i64) -> Result<u64, StoreError> {
    let mut restored = read_l0_version(tx,id,source_revision)?.ok_or(StoreError::MissingReference)?;
    restored.revision = expected_current_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    restored.status = FactStatus::Active;
    append_l0_version(tx,&restored,Some(expected_current_revision),recorded_at_utc_us,L0ChangeOrigin::Restored)?;
    Ok(restored.revision)
}

fn encode_provenance(value: &Provenance) -> Result<(&'static str, String), StoreError> {
    match value {
        Provenance::Manual { created_at_utc_micros } => Ok((
            "manual",
            serde_json::to_string(&serde_json::json!({
                "created_at_utc_micros": created_at_utc_micros
            }))
            .map_err(|_| StoreError::InvalidDomainValue)?,
        )),
        Provenance::Imported { evidence_ids } => {
            let ids = evidence_ids.iter().map(|value| value.as_str()).collect::<Vec<_>>();
            Ok((
                "imported",
                serde_json::to_string(&serde_json::json!({ "evidence_ids": ids }))
                    .map_err(|_| StoreError::InvalidDomainValue)?,
            ))
        }
    }
}
