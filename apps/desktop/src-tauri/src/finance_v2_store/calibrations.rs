use rusqlite::{params, OptionalExtension, Transaction};

use crate::finance_v2_domain::{CalibrationPoint, CalibrationStatus};
use super::{accounts::require_active_account, StoreError};

pub fn append_calibration_version(
    tx: &Transaction<'_>,
    point: &CalibrationPoint,
    expected_revision: Option<u64>,
) -> Result<u64, StoreError> {
    if point.revision == 0 { return Err(StoreError::InvalidDomainValue); }
    let revision = i64::try_from(point.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let expected = expected_revision.map(i64::try_from).transpose().map_err(|_| StoreError::InvalidDomainValue)?;
    let current: Option<i64> = tx.query_row("SELECT revision FROM finance_v2_calibration_current WHERE id=?1", [point.id.as_str()], |row| row.get(0)).optional()?;
    match (current, expected) {
        (None, None) if revision == 1 => {},
        (Some(now), Some(want)) if now == want && want.checked_add(1) == Some(revision) => {},
        _ => return Err(StoreError::StaleRevision),
    }
    if point.status == CalibrationStatus::Active { require_active_account(tx, point.account_id.as_str())?; }
    let status = match point.status { CalibrationStatus::Active => "active", CalibrationStatus::Deleted => "deleted" };
    tx.execute("INSERT INTO finance_v2_calibration_versions(id,revision,account_id,business_date,coefficient,scale,commodity,status,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![point.id.as_str(),revision,point.account_id.as_str(),point.business_date.as_string(),point.quantity.amount.coefficient().to_string(),point.quantity.amount.scale(),point.quantity.commodity.as_str(),status,point.recorded_at_utc_micros])?;
    if current.is_none() {
        tx.execute("INSERT INTO finance_v2_calibration_current(id,revision,account_id,business_date,commodity,status) VALUES (?1,?2,?3,?4,?5,?6)", params![point.id.as_str(),revision,point.account_id.as_str(),point.business_date.as_string(),point.quantity.commodity.as_str(),status])?;
    } else {
        let changed = tx.execute("UPDATE finance_v2_calibration_current SET revision=?2,account_id=?3,business_date=?4,commodity=?5,status=?6 WHERE id=?1 AND revision=?7", params![point.id.as_str(),revision,point.account_id.as_str(),point.business_date.as_string(),point.quantity.commodity.as_str(),status,expected])?;
        if changed != 1 { return Err(StoreError::StaleRevision); }
    }
    Ok(point.revision)
}

pub fn restore_calibration(
    tx: &Transaction<'_>,
    prior: &CalibrationPoint,
    expected_revision: u64,
    recorded_at_utc_us: i64,
) -> Result<u64, StoreError> {
    let revision = expected_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    let restored = CalibrationPoint { revision, status: CalibrationStatus::Active, recorded_at_utc_micros: recorded_at_utc_us, ..prior.clone() };
    append_calibration_version(tx, &restored, Some(expected_revision))
}

pub fn read_calibration_history(tx:&Transaction<'_>,id:&crate::finance_v2_domain::Id)->Result<Vec<CalibrationPoint>,StoreError>{
    let mut stmt=tx.prepare("SELECT revision,account_id,business_date,coefficient,scale,commodity,status,recorded_at_utc_us FROM finance_v2_calibration_versions WHERE id=?1 ORDER BY revision")?;
    let rows=stmt.query_map([id.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,i64>(7)?)))?;
    let mut values=Vec::new();
    for row in rows {
        let (revision,account,date,coefficient,scale,commodity,status,recorded)=row?;
        let coefficient=coefficient.parse::<i128>().map_err(|_|StoreError::IncompatibleSchema)?;
        values.push(CalibrationPoint {
            id:id.clone(),revision:u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?,
            account_id:crate::finance_v2_domain::Id::parse(account).map_err(|_|StoreError::IncompatibleSchema)?,
            business_date:crate::finance_v2_domain::BusinessDate::parse(&date).map_err(|_|StoreError::IncompatibleSchema)?,
            quantity:crate::finance_v2_domain::Quantity::new(crate::finance_v2_domain::Amount::new(coefficient,u8::try_from(scale).map_err(|_|StoreError::IncompatibleSchema)?).map_err(|_|StoreError::IncompatibleSchema)?,crate::finance_v2_domain::CommodityCode::parse(commodity).map_err(|_|StoreError::IncompatibleSchema)?),
            status:match status.as_str(){"active"=>CalibrationStatus::Active,"deleted"=>CalibrationStatus::Deleted,_=>return Err(StoreError::IncompatibleSchema)},
            recorded_at_utc_micros:recorded,
        });
    }
    Ok(values)
}
