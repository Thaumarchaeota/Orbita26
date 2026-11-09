use rusqlite::Transaction;
use serde_json::Value;

use crate::finance_v2_domain::{Account, AccountKind, Amount, BusinessDate, CalibrationPoint, CalibrationStatus, CommodityCode, Id, LedgerSnapshot, MergeGroup, Quantity, RefundEdge, Treatment, Via};
use super::{l0, treatments, StoreError};

/// Caller owns a read transaction; every collection and generation is read from that single SQLite snapshot.
pub fn read_ledger_snapshot(tx: &Transaction<'_>) -> Result<LedgerSnapshot, StoreError> {
    let generation: i64 = tx.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1", [], |r| r.get(0))?;
    let mut accounts = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT id,revision,name,kind,bean_path,parent_id,active,ever_used FROM finance_v2_accounts ORDER BY id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,i64>(6)?,r.get::<_,i64>(7)?)))?;
        for row in rows {
            let (id,revision,name,kind,bean_path,parent,active,ever_used)=row?;
            accounts.push(Account {
                id: parse_id(id)?, revision: from_i64(revision)?, name,
                kind: match kind.as_str(){"Assets"=>AccountKind::Assets,"Liabilities"=>AccountKind::Liabilities,"Equity"=>AccountKind::Equity,"Income"=>AccountKind::Income,"Expenses"=>AccountKind::Expenses,_=>return Err(StoreError::IncompatibleSchema)},
                bean_path, parent_id: parent.map(parse_id).transpose()?, active: active==1, ever_used: ever_used==1,
            });
        }
    }
    let mut vias = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT id,revision,name,active FROM finance_v2_vias ORDER BY id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?)))?;
        for row in rows { let (id,revision,name,active)=row?; vias.push(Via { id:parse_id(id)?, revision:from_i64(revision)?, name, active:active==1 }); }
    }
    let mut active_leaf_facts = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT c.id,c.revision FROM finance_v2_l0_current c JOIN finance_v2_l0_versions v USING(id,revision) WHERE v.status='active' ORDER BY c.id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?)))?;
        for row in rows { let (id,revision)=row?; let id=parse_id(id)?; active_leaf_facts.push(l0::read_l0_version(tx,&id,from_i64(revision)?)?.ok_or(StoreError::IncompatibleSchema)?); }
    }
    let mut current_treatments = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT v.id,v.revision,v.owner_l0_id,v.members_payload,v.merge_groups_payload,v.refund_edges_payload,v.title,v.notes FROM finance_v2_treatment_current c JOIN finance_v2_treatment_versions v USING(id,revision) WHERE v.status='active' ORDER BY v.id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?)))?;
        for row in rows {
            let (id,revision,owner,members,groups,refunds,title,notes)=row?;
            current_treatments.push(Treatment {
                id:parse_id(id)?, revision:from_i64(revision)?, owner_l0_id:parse_id(owner)?,
                members:treatments::decode_members(&members)?, merge_groups:decode_merge_groups(&groups)?,
                refund_edges:decode_refund_edges(&refunds)?, title, notes,
            });
        }
    }
    let calibrations = read_current_calibrations(tx)?;
    Ok(LedgerSnapshot { generation:from_i64(generation)?, accounts, vias, active_leaf_facts, current_treatments, calibrations })
}

pub fn advance_ledger_generation(tx: &Transaction<'_>) -> Result<u64, StoreError> {
    let changed = tx.execute("UPDATE finance_v2_ledger_state SET generation=generation+1 WHERE singleton=1", [])?;
    if changed != 1 { return Err(StoreError::IncompatibleSchema); }
    let value: i64 = tx.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1", [], |r| r.get(0))?;
    from_i64(value)
}

pub fn read_current_calibrations(tx: &Transaction<'_>) -> Result<Vec<CalibrationPoint>, StoreError> {
    let mut stmt = tx.prepare("SELECT v.id,v.revision,v.account_id,v.business_date,v.coefficient,v.scale,v.commodity,v.status,v.recorded_at_utc_us FROM finance_v2_calibration_current c JOIN finance_v2_calibration_versions v USING(id,revision) ORDER BY v.id")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,i64>(8)?)))?;
    let mut values = Vec::new();
    for row in rows {
        let (id,revision,account,date,coefficient,scale,commodity,status,recorded)=row?;
        values.push(CalibrationPoint {
            id:parse_id(id)?, revision:from_i64(revision)?, account_id:parse_id(account)?,
            business_date:BusinessDate::parse(&date).map_err(|_| StoreError::IncompatibleSchema)?,
            quantity:Quantity::new(Amount::new(coefficient.parse().map_err(|_| StoreError::IncompatibleSchema)?,u8::try_from(scale).map_err(|_| StoreError::IncompatibleSchema)?).map_err(|_| StoreError::IncompatibleSchema)?,CommodityCode::parse(commodity).map_err(|_| StoreError::IncompatibleSchema)?),
            status:match status.as_str(){"active"=>CalibrationStatus::Active,"deleted"=>CalibrationStatus::Deleted,_=>return Err(StoreError::IncompatibleSchema)},
            recorded_at_utc_micros:recorded,
        });
    }
    Ok(values)
}

pub fn read_treatment_history(tx:&Transaction<'_>,id:&Id)->Result<Vec<Treatment>,StoreError>{
    Ok(read_treatment_history_entries(tx,id)?.into_iter().map(|entry|entry.treatment).collect())
}

#[derive(Clone,Debug)]
pub struct TreatmentHistoryEntry { pub treatment:Treatment, pub status:treatments::TreatmentStatus, pub recorded_at_utc_us:i64 }

pub fn read_treatment_history_entries(tx:&Transaction<'_>,id:&Id)->Result<Vec<TreatmentHistoryEntry>,StoreError>{
    let mut stmt=tx.prepare("SELECT revision,owner_l0_id,members_payload,merge_groups_payload,refund_edges_payload,title,notes,status,recorded_at_utc_us FROM finance_v2_treatment_versions WHERE id=?1 ORDER BY revision")?;
    let rows=stmt.query_map([id.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,i64>(8)?)))?;
    let mut values=Vec::new();
    for row in rows {
        let (revision,owner,members,groups,refunds,title,notes,status,recorded)=row?;
        let status=match status.as_str(){"active"=>treatments::TreatmentStatus::Active,"deleted"=>treatments::TreatmentStatus::Deleted,_=>return Err(StoreError::IncompatibleSchema)};
        values.push(TreatmentHistoryEntry{treatment:Treatment{id:id.clone(),revision:from_i64(revision)?,owner_l0_id:parse_id(owner)?,members:treatments::decode_members(&members)?,merge_groups:decode_merge_groups(&groups)?,refund_edges:decode_refund_edges(&refunds)?,title,notes},status,recorded_at_utc_us:recorded});
    }
    Ok(values)
}

fn decode_merge_groups(payload:&str)->Result<Vec<MergeGroup>,StoreError>{
    let values:Vec<Vec<Value>>=serde_json::from_str(payload).map_err(|_|StoreError::IncompatibleSchema)?;
    values.into_iter().map(|group| {
        let encoded=serde_json::to_string(&group).map_err(|_|StoreError::IncompatibleSchema)?;
        Ok(MergeGroup{members:treatments::decode_members(&encoded)?})
    }).collect()
}

fn decode_refund_edges(payload:&str)->Result<Vec<RefundEdge>,StoreError>{
    let values:Vec<Value>=serde_json::from_str(payload).map_err(|_|StoreError::IncompatibleSchema)?;
    values.into_iter().map(|v|{
        let refund=member_from(v.get("refund").ok_or(StoreError::IncompatibleSchema)?)?;
        let payment=member_from(v.get("payment").ok_or(StoreError::IncompatibleSchema)?)?;
        let coefficient=v.get("coefficient").and_then(Value::as_str).ok_or(StoreError::IncompatibleSchema)?.parse::<i128>().map_err(|_|StoreError::IncompatibleSchema)?;
        let scale=u8::try_from(v.get("scale").and_then(Value::as_u64).ok_or(StoreError::IncompatibleSchema)?).map_err(|_|StoreError::IncompatibleSchema)?;
        let commodity=v.get("commodity").and_then(Value::as_str).ok_or(StoreError::IncompatibleSchema)?;
        Ok(RefundEdge{refund,payment,amount:Quantity::new(Amount::new(coefficient,scale).map_err(|_|StoreError::IncompatibleSchema)?,CommodityCode::parse(commodity).map_err(|_|StoreError::IncompatibleSchema)?)} )
    }).collect()
}

fn member_from(v:&Value)->Result<crate::finance_v2_domain::MemberRevision,StoreError>{
    let id=v.get("id").and_then(Value::as_str).ok_or(StoreError::IncompatibleSchema)?;
    let revision=v.get("revision").and_then(Value::as_u64).filter(|v|*v>0).ok_or(StoreError::IncompatibleSchema)?;
    Ok(crate::finance_v2_domain::MemberRevision{l0_id:parse_id(id.to_owned())?,revision})
}
fn parse_id(value:String)->Result<Id,StoreError>{Id::parse(value).map_err(|_|StoreError::IncompatibleSchema)}
fn from_i64(value:i64)->Result<u64,StoreError>{u64::try_from(value).map_err(|_|StoreError::IncompatibleSchema)}
