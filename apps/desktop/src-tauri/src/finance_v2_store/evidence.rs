use rusqlite::{params, OptionalExtension, Transaction};

use crate::finance_v2_domain::{
    Amount, CommodityCode, Id, MemberRevision, Quantity,
};

use super::{accounts::require_active_account, StoreError};

#[derive(Clone, Debug)]
pub struct EvidenceRecord {
    pub id: Id,
    pub artifact_id: Id,
    pub locator: String,
    pub occurrence_discriminator: String,
    pub profile_id: String,
    pub profile_revision: String,
    pub raw_text_version: u32,
    pub raw_text: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceRole {
    Ordinary,
    Refinement,
    Refund,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceSign { Positive, Negative }

#[derive(Clone, Debug)]
pub struct RefinementLink {
    pub id: Id,
    pub revision: u64,
    pub evidence_id: Id,
    pub observed_account_id: Id,
    pub observation_role: String,
    pub leaf: MemberRevision,
    pub sign: EvidenceSign,
    pub allocation: Quantity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceLinkVersion {
    pub id: Id,
    pub revision: u64,
    pub evidence_id: Id,
    pub observed_account_id: Id,
    pub observation_role: String,
    pub relation_kind: String,
    pub grouping_kind: String,
    pub group_id: Option<String>,
    pub leaf_l0_id: Option<Id>,
    pub leaf_l0_revision: Option<u64>,
    pub status: String,
    pub allocation_payload: Option<String>,
    pub recorded_at_utc_us: i64,
}

pub fn find_occurrence(
    tx: &Transaction<'_>, artifact_id: &Id, locator: &str, occurrence_discriminator: &str,
) -> Result<Option<EvidenceRecord>, StoreError> {
    let row = tx.query_row("SELECT id,artifact_id,locator,occurrence_discriminator,profile_id,profile_revision,raw_text_version,raw_text FROM finance_v2_evidence WHERE artifact_id=?1 AND locator=?2 AND occurrence_discriminator=?3", params![artifact_id.as_str(),locator,occurrence_discriminator], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,i64>(6)?,r.get::<_,String>(7)?))).optional()?;
    row.map(|(id,artifact_id,locator,occurrence_discriminator,profile_id,profile_revision,raw_version,raw_text)| Ok(EvidenceRecord {
        id: Id::parse(id).map_err(|_| StoreError::IncompatibleSchema)?, artifact_id:Id::parse(artifact_id).map_err(|_|StoreError::IncompatibleSchema)?, locator, occurrence_discriminator,
        profile_id, profile_revision, raw_text_version: u32::try_from(raw_version).map_err(|_| StoreError::IncompatibleSchema)?, raw_text,
    })).transpose()
}

pub fn read_link_history(tx: &Transaction<'_>, id: &Id) -> Result<Vec<EvidenceLinkVersion>, StoreError> {
    let mut statement = tx.prepare("SELECT revision,evidence_id,observed_account_id,observation_role,relation_kind,grouping_kind,group_id,leaf_l0_id,leaf_l0_revision,status,allocation_payload,recorded_at_utc_us FROM finance_v2_evidence_link_history WHERE id=?1 ORDER BY revision")?;
    let rows = statement.query_map([id.as_str()], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<i64>>(8)?,r.get::<_,String>(9)?,r.get::<_,Option<String>>(10)?,r.get::<_,i64>(11)?)))?;
    let mut result = Vec::new();
    for row in rows {
        let (revision,evidence,account,observation_role,relation_kind,grouping,group,leaf,leaf_revision,status,allocation,recorded)=row?;
        result.push(EvidenceLinkVersion {
            id:id.clone(),revision:u64::try_from(revision).map_err(|_| StoreError::IncompatibleSchema)?,
            evidence_id:Id::parse(evidence).map_err(|_| StoreError::IncompatibleSchema)?,
            observed_account_id:Id::parse(account).map_err(|_| StoreError::IncompatibleSchema)?,observation_role,relation_kind,grouping_kind:grouping,group_id:group,
            leaf_l0_id:leaf.map(Id::parse).transpose().map_err(|_| StoreError::IncompatibleSchema)?,
            leaf_l0_revision:leaf_revision.map(u64::try_from).transpose().map_err(|_| StoreError::IncompatibleSchema)?,
            status,allocation_payload:allocation,recorded_at_utc_us:recorded,
        });
    }
    Ok(result)
}

pub fn read_active_links_for_occurrence(
    tx:&Transaction<'_>,artifact_id:&Id,locator:&str,occurrence_discriminator:&str,observed_account_id:&Id,observation_role:&str,
)->Result<Vec<EvidenceLinkVersion>,StoreError>{
    let mut stmt=tx.prepare("SELECT h.id,h.revision,h.evidence_id,h.observed_account_id,h.observation_role,h.relation_kind,h.grouping_kind,h.group_id,h.leaf_l0_id,h.leaf_l0_revision,h.status,h.allocation_payload,h.recorded_at_utc_us FROM finance_v2_evidence e JOIN finance_v2_evidence_link_current c ON c.evidence_id=e.id JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE e.artifact_id=?1 AND e.locator=?2 AND e.occurrence_discriminator=?3 AND h.observed_account_id=?4 AND h.observation_role=?5 AND h.status='active' ORDER BY h.id")?;
    let rows=stmt.query_map(params![artifact_id.as_str(),locator,occurrence_discriminator,observed_account_id.as_str(),observation_role],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,Option<i64>>(9)?,r.get::<_,String>(10)?,r.get::<_,Option<String>>(11)?,r.get::<_,i64>(12)?)))?;
    rows.map(|row|{
        let (id,revision,evidence,account,observation_role,relation_kind,grouping,group,leaf,leaf_rev,status,allocation,recorded)=row?;
        Ok(EvidenceLinkVersion{
            id:parse_id(id)?,revision:from_db(revision)?,evidence_id:parse_id(evidence)?,observed_account_id:parse_id(account)?,observation_role,relation_kind,grouping_kind:grouping,group_id:group,
            leaf_l0_id:leaf.map(parse_id).transpose()?,leaf_l0_revision:leaf_rev.map(from_db).transpose()?,status,allocation_payload:allocation,recorded_at_utc_us:recorded,
        })
    }).collect()
}

fn parse_id(value:String)->Result<Id,StoreError>{Id::parse(value).map_err(|_|StoreError::IncompatibleSchema)}
fn from_db(value:i64)->Result<u64,StoreError>{u64::try_from(value).map_err(|_|StoreError::IncompatibleSchema)}

fn reserve_claim(tx:&Transaction<'_>,evidence:&Id,account:&Id,observation_role:&str,relation:EvidenceRole,group:Option<&str>)->Result<(),StoreError>{
    if observation_role.trim().is_empty(){return Err(StoreError::InvalidDomainValue)}
    let relation=match relation{EvidenceRole::Ordinary=>"ordinary",EvidenceRole::Refinement=>"refinement",EvidenceRole::Refund=>"refund"};
    let current:Option<(String,Option<String>,String)>=tx.query_row("SELECT relation_kind,group_id,status FROM finance_v2_evidence_claim_current WHERE evidence_id=?1 AND observed_account_id=?2 AND observation_role=?3",params![evidence.as_str(),account.as_str(),observation_role],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    match current {
        Some((_,_,status)) if status=="active" => Err(StoreError::InvalidEvidenceAllocation),
        Some(_) => {tx.execute("UPDATE finance_v2_evidence_claim_current SET relation_kind=?4,group_id=?5,status='active' WHERE evidence_id=?1 AND observed_account_id=?2 AND observation_role=?3",params![evidence.as_str(),account.as_str(),observation_role,relation,group])?;Ok(())}
        None => {tx.execute("INSERT INTO finance_v2_evidence_claim_current(evidence_id,observed_account_id,observation_role,relation_kind,group_id,status) VALUES (?1,?2,?3,?4,?5,'active')",params![evidence.as_str(),account.as_str(),observation_role,relation,group])?;Ok(())}
    }
}

fn release_claim(tx:&Transaction<'_>,evidence:&str,account:&str,observation_role:&str,relation:&str,group:Option<&str>)->Result<(),StoreError>{
    let changed=tx.execute("UPDATE finance_v2_evidence_claim_current SET status='released' WHERE evidence_id=?1 AND observed_account_id=?2 AND observation_role=?3 AND relation_kind=?4 AND group_id IS ?5 AND status='active'",params![evidence,account,observation_role,relation,group])?;
    if changed!=1{return Err(StoreError::InvalidEvidenceAllocation)} Ok(())
}

pub fn insert_evidence(
    tx: &Transaction<'_>,
    evidence: &EvidenceRecord,
    created_at_utc_us: i64,
) -> Result<(), StoreError> {
    if evidence.locator.trim().is_empty()
        || evidence.occurrence_discriminator.trim().is_empty()
        || evidence.profile_id.trim().is_empty()
        || evidence.profile_revision.trim().is_empty()
        || evidence.raw_text_version == 0
    {
        return Err(StoreError::InvalidDomainValue);
    }
    let duplicate: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM finance_v2_evidence WHERE artifact_id=?1 AND locator=?2 AND occurrence_discriminator=?3)",
        params![evidence.artifact_id.as_str(), evidence.locator, evidence.occurrence_discriminator],
        |row| row.get(0),
    )?;
    if duplicate {
        return Err(StoreError::DuplicateEvidenceOccurrence);
    }
    tx.execute(
        "INSERT INTO finance_v2_evidence(id,artifact_id,locator,occurrence_discriminator,profile_id,profile_revision,raw_text_version,raw_text,created_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            evidence.id.as_str(), evidence.artifact_id.as_str(), evidence.locator,
            evidence.occurrence_discriminator, evidence.profile_id,
            evidence.profile_revision, evidence.raw_text_version,
            evidence.raw_text, created_at_utc_us,
        ],
    )?;
    Ok(())
}

pub fn append_ordinary_link(
    tx: &Transaction<'_>,
    id: &Id,
    evidence_id: &Id,
    observed_account_id: &Id,
    observation_role: &str,
    role: EvidenceRole,
    leaf: &MemberRevision,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
) -> Result<u64, StoreError> {
    if role != EvidenceRole::Ordinary { return Err(StoreError::InvalidDomainValue); }
    tx.execute_batch("SAVEPOINT finance_v2_ordinary_link")?;
    let result=(||->Result<u64,StoreError>{
        let current_fact = require_active_leaf(tx, leaf, observed_account_id)?;
        if current_fact.is_none() { return Err(StoreError::StaleRevision); }
        require_active_account(tx, observed_account_id.as_str())?;
        reserve_claim(tx,evidence_id,observed_account_id,observation_role,role,None)?;
        let revision=append_link(tx,id,evidence_id,observed_account_id,observation_role,role,"ordinary",None,Some(leaf),None,None,None,None,expected_revision,recorded_at_utc_us)?;
        validate_occurrence_claims(tx)?;
        Ok(revision)
    })();
    match result{Ok(rev)=>{tx.execute_batch("RELEASE finance_v2_ordinary_link")?;Ok(rev)},Err(e)=>{tx.execute_batch("ROLLBACK TO finance_v2_ordinary_link; RELEASE finance_v2_ordinary_link")?;Err(e)}}
}

pub fn append_refund_link(
    tx:&Transaction<'_>,id:&Id,evidence_id:&Id,observed_account_id:&Id,observation_role:&str,
    leaf:&MemberRevision,expected_revision:Option<u64>,recorded_at_utc_us:i64,
)->Result<u64,StoreError>{
    tx.execute_batch("SAVEPOINT finance_v2_refund_link")?;
    let result=(||->Result<u64,StoreError>{
        let current_fact=require_active_leaf(tx,leaf,observed_account_id)?;
        if current_fact.is_none(){return Err(StoreError::StaleRevision)}
        require_active_account(tx,observed_account_id.as_str())?;
        reserve_claim(tx,evidence_id,observed_account_id,observation_role,EvidenceRole::Refund,None)?;
        let revision=append_link(tx,id,evidence_id,observed_account_id,observation_role,EvidenceRole::Refund,"ordinary",None,Some(leaf),None,None,None,None,expected_revision,recorded_at_utc_us)?;
        validate_occurrence_claims(tx)?;
        Ok(revision)
    })();
    match result{Ok(rev)=>{tx.execute_batch("RELEASE finance_v2_refund_link")?;Ok(rev)},Err(e)=>{tx.execute_batch("ROLLBACK TO finance_v2_refund_link; RELEASE finance_v2_refund_link")?;Err(e)}}
}

/// Adds a complete refinement allocation as one caller-owned transaction.
/// Each child's amount for the observed account must match its allocated piece,
/// and the exact pieces must sum to the confirmed source quantity.
pub fn append_refinement_group(
    tx: &Transaction<'_>,
    group_id: &str,
    evidence_id: &Id,
    observed_account_id: &Id,
    observation_role: &str,
    source_quantity: &Quantity,
    source_sign: EvidenceSign,
    links: &[RefinementLink],
    recorded_at_utc_us: i64,
) -> Result<(), StoreError> {
    tx.execute_batch("SAVEPOINT finance_v2_refinement_write")?;
    let result=append_refinement_group_inner(tx,group_id,evidence_id,observed_account_id,observation_role,source_quantity,source_sign,links,recorded_at_utc_us);
    match result { Ok(())=>{tx.execute_batch("RELEASE finance_v2_refinement_write")?;Ok(())},Err(e)=>{tx.execute_batch("ROLLBACK TO finance_v2_refinement_write; RELEASE finance_v2_refinement_write")?;Err(e)} }
}

fn append_refinement_group_inner(
    tx: &Transaction<'_>, group_id:&str, evidence_id:&Id, observed_account_id:&Id, observation_role:&str,
    source_quantity:&Quantity, source_sign:EvidenceSign, links:&[RefinementLink], recorded_at_utc_us:i64,
)->Result<(),StoreError>{
    if group_id.trim().is_empty()
        || links.is_empty()
        || !source_quantity.amount.is_positive()
    {
        return Err(StoreError::InvalidEvidenceAllocation);
    }
    reserve_claim(tx,evidence_id,observed_account_id,observation_role,EvidenceRole::Refinement,Some(group_id))?;
    require_active_account(tx, observed_account_id.as_str())?;
    let mut sum = Amount::new(0, 0).map_err(|_| StoreError::InvalidEvidenceAllocation)?;
    let mut seen_leaves = std::collections::HashSet::new();
    for link in links {
        if link.evidence_id != *evidence_id
            || link.observed_account_id != *observed_account_id
            || link.observation_role != observation_role
            || !seen_leaves.insert(link.leaf.l0_id.as_str())
            || !link.allocation.amount.is_positive()
            || link.allocation.commodity != source_quantity.commodity
        {
            return Err(StoreError::InvalidEvidenceAllocation);
        }
        let duplicate_id:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM finance_v2_evidence_link_current WHERE id=?1)",[link.id.as_str()],|r|r.get(0))?;
        if duplicate_id{return Err(StoreError::DuplicateEvidenceOccurrence)}
        let (actual,actual_sign) = require_active_leaf(tx, &link.leaf, observed_account_id)?
            .ok_or(StoreError::StaleRevision)?;
        if actual_sign != link.sign || link.sign != source_sign || actual.commodity != link.allocation.commodity
            || actual.amount.exact_cmp(link.allocation.amount).ok()
                != Some(std::cmp::Ordering::Equal)
        {
            return Err(StoreError::InvalidEvidenceAllocation);
        }
        sum = sum
            .checked_add(link.allocation.amount)
            .map_err(|_| StoreError::InvalidEvidenceAllocation)?;
    }
    if sum.exact_cmp(source_quantity.amount).ok() != Some(std::cmp::Ordering::Equal) {
        return Err(StoreError::InvalidEvidenceAllocation);
    }
    for link in links {
        append_link(
            tx,
            &link.id,
            evidence_id,
            observed_account_id,
            observation_role,
            EvidenceRole::Refinement,
            "refinement",
            Some(group_id),
            Some(&link.leaf),
            Some(&link.allocation),
            Some(link.sign),
            Some(source_quantity),
            Some(source_sign),
            None,
            recorded_at_utc_us,
        )?;
    }
    validate_occurrence_claims(tx)?;
    Ok(())
}

pub fn revoke_link(
    tx: &Transaction<'_>,
    id: &Id,
    expected_revision: u64,
    recorded_at_utc_us: i64,
) -> Result<u64, StoreError> {
    tx.execute_batch("SAVEPOINT finance_v2_revoke_link")?;
    let result=revoke_link_inner(tx,id,expected_revision,None,recorded_at_utc_us,false);
    match result{Ok(rev)=>{tx.execute_batch("RELEASE finance_v2_revoke_link")?;Ok(rev)},Err(e)=>{tx.execute_batch("ROLLBACK TO finance_v2_revoke_link; RELEASE finance_v2_revoke_link")?;Err(e)}}
}

pub fn revoke_link_for_operation(tx:&Transaction<'_>,id:&Id,expected_revision:u64,operation_id:&Id,recorded_at_utc_us:i64)->Result<u64,StoreError>{
    tx.execute_batch("SAVEPOINT finance_v2_revoke_link_op")?;
    let result=revoke_link_inner(tx,id,expected_revision,Some(operation_id),recorded_at_utc_us,false);
    match result{Ok(rev)=>{tx.execute_batch("RELEASE finance_v2_revoke_link_op")?;Ok(rev)},Err(e)=>{tx.execute_batch("ROLLBACK TO finance_v2_revoke_link_op; RELEASE finance_v2_revoke_link_op")?;Err(e)}}
}

/// Validates the cross-relation reservation invariant for a complete write transaction.
pub fn validate_occurrence_claims(tx:&Transaction<'_>)->Result<(),StoreError>{
    let broken:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM finance_v2_evidence_claim_current c LEFT JOIN finance_v2_evidence_link_current l ON l.evidence_id=c.evidence_id AND l.observed_account_id=c.observed_account_id AND l.observation_role=c.observation_role AND l.status='active' WHERE c.status='active' GROUP BY c.evidence_id,c.observed_account_id,c.observation_role HAVING COUNT(l.id)=0 OR COUNT(DISTINCT l.relation_kind)>1 OR MIN(l.relation_kind)<>c.relation_kind OR (c.relation_kind='refinement' AND (COUNT(DISTINCT l.group_id)>1 OR MIN(l.group_id)<>c.group_id)) OR (c.relation_kind<>'refinement' AND COUNT(l.id)<>1)) OR EXISTS(SELECT 1 FROM finance_v2_evidence_link_current l LEFT JOIN finance_v2_evidence_claim_current c ON c.evidence_id=l.evidence_id AND c.observed_account_id=l.observed_account_id AND c.observation_role=l.observation_role AND c.status='active' WHERE l.status='active' AND c.evidence_id IS NULL)",[],|r|r.get(0))?;
    if broken{Err(StoreError::InvalidEvidenceAllocation)}else{Ok(())}
}

fn revoke_link_inner(tx:&Transaction<'_>,id:&Id,expected_revision:u64,operation_id:Option<&Id>,recorded_at_utc_us:i64,allow_refinement:bool)->Result<u64,StoreError>{
    let expected = i64::try_from(expected_revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let next = expected.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    let row = tx.query_row(
        "SELECT h.evidence_id,h.observed_account_id,h.observation_role,h.relation_kind,h.grouping_kind,h.group_id,h.leaf_l0_id,h.leaf_l0_revision,h.allocation_payload FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.id=?1 AND c.revision=?2 AND c.status='active'",
        params![id.as_str(), expected],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?, row.get::<_, Option<i64>>(7)?,
            row.get::<_, Option<String>>(8)?,
        )),
    ).optional()?.ok_or(StoreError::StaleRevision)?;
    if row.3=="refinement" && !allow_refinement { return Err(StoreError::InvalidEvidenceAllocation); }
    let updated = tx.execute(
        "INSERT INTO finance_v2_evidence_link_history(id,revision,evidence_id,observed_account_id,observation_role,relation_kind,grouping_kind,group_id,leaf_l0_id,leaf_l0_revision,status,allocation_payload,recorded_at_utc_us,revocation_operation_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'revoked',?11,?12,?13)",
        params![
            id.as_str(), next, row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7,
            row.8, recorded_at_utc_us, operation_id.map(Id::as_str),
        ],
    )?;
    if updated != 1 {
        return Err(StoreError::StaleRevision);
    }
    tx.execute(
        "UPDATE finance_v2_evidence_link_current SET revision=?2,status='revoked' WHERE id=?1 AND revision=?3",
        params![id.as_str(), next, expected],
    )?;
    if !allow_refinement { release_claim(tx,&row.0,&row.1,&row.2,&row.3,row.5.as_deref())?; }
    Ok(next as u64)
}

/// Revoke every member of a refinement allocation together. A caller cannot
/// leave a partial active group by revoking one link at a time.
pub fn revoke_refinement_group(tx:&Transaction<'_>,group_id:&str,recorded_at_utc_us:i64)->Result<usize,StoreError>{
    revoke_refinement_group_inner(tx,group_id,None,recorded_at_utc_us)
}

pub fn revoke_refinement_group_for_operation(tx:&Transaction<'_>,group_id:&str,operation_id:&Id,recorded_at_utc_us:i64)->Result<usize,StoreError>{
    revoke_refinement_group_inner(tx,group_id,Some(operation_id),recorded_at_utc_us)
}

fn revoke_refinement_group_inner(tx:&Transaction<'_>,group_id:&str,operation_id:Option<&Id>,recorded_at_utc_us:i64)->Result<usize,StoreError>{
    if group_id.trim().is_empty(){return Err(StoreError::InvalidDomainValue)}
    tx.execute_batch("SAVEPOINT finance_v2_refinement_revoke")?;
    let result=(||->Result<usize,StoreError>{
        let mut stmt=tx.prepare("SELECT c.id,c.revision,c.evidence_id,c.observed_account_id,c.observation_role FROM finance_v2_evidence_link_current c WHERE c.group_id=?1 AND c.grouping_kind='refinement' AND c.relation_kind='refinement' AND c.status='active' ORDER BY c.id")?;
        let rows=stmt.query_map([group_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?)))?;
        let mut links=Vec::new();for row in rows{links.push(row?)} drop(stmt);
        if links.is_empty(){return Err(StoreError::InvalidEvidenceAllocation)}
        let mut evidence_and_account_role:Option<(String,String,String)>=None;
        for (_,_,evidence,account,observation_role) in &links{
            let pair=(evidence.clone(),account.clone(),observation_role.clone());
            if evidence_and_account_role.as_ref().is_some_and(|prior|prior!=&pair){return Err(StoreError::InvalidEvidenceAllocation)}
            evidence_and_account_role=Some(pair);
        }
        for (id,revision,_,_,_) in &links{let id=Id::parse(id.clone()).map_err(|_|StoreError::IncompatibleSchema)?;revoke_link_inner(tx,&id,u64::try_from(*revision).map_err(|_|StoreError::IncompatibleSchema)?,operation_id,recorded_at_utc_us,true)?;}
        if let Some((evidence,account,observation_role))=evidence_and_account_role{release_claim(tx,&evidence,&account,&observation_role,"refinement",Some(group_id))?;}
        Ok(links.len())
    })();
    match result{Ok(count)=>{tx.execute_batch("RELEASE finance_v2_refinement_revoke")?;Ok(count)},Err(e)=>{tx.execute_batch("ROLLBACK TO finance_v2_refinement_revoke; RELEASE finance_v2_refinement_revoke")?;Err(e)}}
}

pub fn revoked_links_for_operation(tx:&Transaction<'_>,fact_id:&Id,source_revision:u64,operation_id:&Id)->Result<(std::collections::BTreeSet<String>,std::collections::BTreeMap<String,std::collections::BTreeSet<String>>),StoreError>{
    let mut stmt=tx.prepare("SELECT c.id,h.grouping_kind,h.group_id FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.status='revoked' AND h.status='revoked' AND h.revocation_operation_id=?1 AND h.leaf_l0_id=?2 AND h.leaf_l0_revision=?3 ORDER BY c.id")?;
    let rows=stmt.query_map(params![operation_id.as_str(),fact_id.as_str(),i64::try_from(source_revision).map_err(|_|StoreError::InvalidDomainValue)?],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?)))?;
    let mut ordinary=std::collections::BTreeSet::new();
    let mut groups=std::collections::BTreeMap::<String,std::collections::BTreeSet<String>>::new();
    for row in rows{
        let (link_id,grouping,group_id)=row?;
        match grouping.as_str(){
            "ordinary"=>{ordinary.insert(link_id);}
            "refinement"=>{let group=group_id.ok_or(StoreError::IncompatibleSchema)?;groups.entry(group).or_default().insert(link_id);}
            _=>return Err(StoreError::InvalidEvidenceAllocation),
        }
    }
    for (group,members) in groups.iter_mut(){
        let mut stmt=tx.prepare("SELECT c.id FROM finance_v2_evidence_link_current c JOIN finance_v2_evidence_link_history h USING(id,revision) WHERE c.status='revoked' AND h.status='revoked' AND h.revocation_operation_id=?1 AND h.group_id=?2 AND h.grouping_kind='refinement' ORDER BY c.id")?;
        let rows=stmt.query_map(params![operation_id.as_str(),group],|r|r.get::<_,String>(0))?;
        for row in rows{members.insert(row?);}
    }
    Ok((ordinary,groups))
}

fn append_link(
    tx: &Transaction<'_>,
    id: &Id,
    evidence_id: &Id,
    observed_account_id: &Id,
    observation_role: &str,
    role: EvidenceRole,
    grouping_kind: &str,
    group_id: Option<&str>,
    leaf: Option<&MemberRevision>,
    allocation: Option<&Quantity>,
    allocation_sign: Option<EvidenceSign>,
    source_quantity: Option<&Quantity>,
    source_sign: Option<EvidenceSign>,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
) -> Result<u64, StoreError> {
    let current: Option<i64> = tx.query_row(
        "SELECT revision FROM finance_v2_evidence_link_current WHERE id=?1",
        [id.as_str()],
        |row| row.get(0),
    ).optional()?;
    let expected = expected_revision
        .map(i64::try_from)
        .transpose()
        .map_err(|_| StoreError::InvalidDomainValue)?;
    let revision = match (current, expected) {
        (None, None) => 1_i64,
        (Some(current), Some(expected)) if current == expected => current.checked_add(1).ok_or(StoreError::InvalidDomainValue)?,
        _ => return Err(StoreError::StaleRevision),
    };
    let (leaf_id, leaf_revision) = match leaf {
        Some(value) => (
            Some(value.l0_id.as_str()),
            Some(i64::try_from(value.revision).map_err(|_| StoreError::InvalidDomainValue)?),
        ),
        None => (None, None),
    };
    let (relation_kind, status) = match role {
        EvidenceRole::Ordinary => ("ordinary", "active"),
        EvidenceRole::Refinement => ("refinement", "active"),
        EvidenceRole::Refund => ("refund", "active"),
    };
    if (grouping_kind == "ordinary" && group_id.is_some())
        || (grouping_kind == "refinement" && group_id.is_none())
    {
        return Err(StoreError::InvalidDomainValue);
    }
    let allocation_payload = match (allocation, allocation_sign, source_quantity, source_sign) {
        (Some(value),Some(sign),Some(source),Some(source_sign)) => Some(serde_json::to_string(&serde_json::json!({
            "allocation":{"coefficient":value.amount.coefficient().to_string(),"scale":value.amount.scale(),"commodity":value.commodity.as_str(),"sign":encode_sign(sign)},
            "source":{"coefficient":source.amount.coefficient().to_string(),"scale":source.amount.scale(),"commodity":source.commodity.as_str(),"sign":encode_sign(source_sign)},
        })).map_err(|_| StoreError::InvalidDomainValue)?),
        (None,None,None,None) => None,
        _ => return Err(StoreError::InvalidEvidenceAllocation),
    };
    tx.execute(
        "INSERT INTO finance_v2_evidence_link_history(id,revision,evidence_id,observed_account_id,observation_role,relation_kind,grouping_kind,group_id,leaf_l0_id,leaf_l0_revision,status,allocation_payload,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            id.as_str(), revision, evidence_id.as_str(), observed_account_id.as_str(),
            observation_role, relation_kind, grouping_kind, group_id, leaf_id, leaf_revision, status, allocation_payload,
            recorded_at_utc_us,
        ],
    )?;
    if current.is_none() {
        tx.execute(
            "INSERT INTO finance_v2_evidence_link_current(id,revision,evidence_id,observed_account_id,observation_role,relation_kind,grouping_kind,group_id,leaf_l0_id,leaf_l0_revision,status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![id.as_str(), revision, evidence_id.as_str(), observed_account_id.as_str(), observation_role, relation_kind, grouping_kind, group_id, leaf_id, leaf_revision, status],
        )?;
    } else {
        let updated = tx.execute(
            "UPDATE finance_v2_evidence_link_current SET revision=?2,evidence_id=?3,observed_account_id=?4,observation_role=?5,relation_kind=?6,grouping_kind=?7,group_id=?8,leaf_l0_id=?9,leaf_l0_revision=?10,status=?11 WHERE id=?1 AND revision=?12",
            params![id.as_str(), revision, evidence_id.as_str(), observed_account_id.as_str(), observation_role, relation_kind, grouping_kind, group_id, leaf_id, leaf_revision, status, expected],
        )?;
        if updated != 1 {
            return Err(StoreError::StaleRevision);
        }
    }
    Ok(revision as u64)
}

fn require_active_leaf(
    tx: &Transaction<'_>,
    member: &MemberRevision,
    observed_account_id: &Id,
) -> Result<Option<(Quantity,EvidenceSign)>, StoreError> {
    let revision = i64::try_from(member.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let row = tx.query_row(
        "SELECT v.status,v.positive_account_id,v.positive_coefficient,v.positive_scale,v.positive_commodity,v.negative_account_id,v.negative_coefficient,v.negative_scale,v.negative_commodity,c.revision FROM finance_v2_l0_versions v JOIN finance_v2_l0_current c ON c.id=v.id WHERE v.id=?1 AND v.revision=?2",
        params![member.l0_id.as_str(), revision],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?,
            row.get::<_, String>(6)?, row.get::<_, i64>(7)?, row.get::<_, String>(8)?,
            row.get::<_, i64>(9)?,
        )),
    ).optional()?;
    let Some((status, positive_account, positive_coefficient, positive_scale, positive_commodity,
        negative_account, negative_coefficient, negative_scale, negative_commodity, current_revision)) = row else {
        return Ok(None);
    };
    if current_revision != revision || status != "active" {
        return Ok(None);
    }
    let (coefficient, scale, commodity,sign) = if positive_account == observed_account_id.as_str() {
        (positive_coefficient, positive_scale, positive_commodity,EvidenceSign::Positive)
    } else if negative_account == observed_account_id.as_str() {
        (negative_coefficient, negative_scale, negative_commodity,EvidenceSign::Negative)
    } else {
        return Err(StoreError::InvalidEvidenceAllocation);
    };
    let coefficient = coefficient.parse::<i128>().map_err(|_| StoreError::IncompatibleSchema)?;
    let scale = u8::try_from(scale).map_err(|_| StoreError::IncompatibleSchema)?;
    let amount = Amount::new(coefficient, scale).map_err(|_| StoreError::IncompatibleSchema)?;
    let commodity = CommodityCode::parse(commodity).map_err(|_| StoreError::IncompatibleSchema)?;
    Ok(Some((Quantity::new(amount, commodity),sign)))
}

fn encode_sign(sign:EvidenceSign)->&'static str{match sign{EvidenceSign::Positive=>"positive",EvidenceSign::Negative=>"negative"}}
