use rusqlite::{params, OptionalExtension, Transaction};

use crate::finance_v2_domain::{Account, AccountKind, Via};
use crate::finance_v2_domain::Id;

use super::StoreError;

#[derive(Clone,Debug,Eq,PartialEq,serde::Serialize,serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountViaBinding { pub account_id:Id,pub via_id:Id,pub revision:u64,pub active:bool }

pub fn save_account(
    tx: &Transaction<'_>,
    account: &Account,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
) -> Result<(), StoreError> {
    if account.revision == 0 || account.name.trim().is_empty() {
        return Err(StoreError::InvalidDomainValue);
    }
    let account_revision = i64::try_from(account.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let id = account.id.as_str();
    let current = tx
        .query_row(
            "SELECT revision, kind FROM finance_v2_accounts WHERE id=?1",
            [id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;

    let expected_revision_i64 = expected_revision
        .map(i64::try_from)
        .transpose()
        .map_err(|_| StoreError::InvalidDomainValue)?;
    match (current.as_ref(), expected_revision_i64) {
        (None, None) if account_revision == 1 => {}
        (Some((revision, _)), Some(expected))
            if *revision == expected && expected.checked_add(1) == Some(account_revision) => {}
        _ => return Err(StoreError::StaleRevision),
    }

    let kind = encode_kind(account.kind);
    if let Some((_, old_kind)) = current.as_ref() {
        if old_kind != kind {
            let used: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM finance_v2_l0_versions WHERE positive_account_id=?1 OR negative_account_id=?1)",
                [id],
                |row| row.get(0),
            )?;
            if used {
                return Err(StoreError::ImmutableAccountKind);
            }
        }
    }

    if let Some(parent_id) = &account.parent_id {
        let would_cycle: bool = tx.query_row(
            "WITH RECURSIVE descendants(id) AS (SELECT ?1 UNION ALL SELECT child.id FROM finance_v2_accounts child JOIN descendants d ON child.parent_id=d.id) SELECT EXISTS(SELECT 1 FROM descendants WHERE id=?2)",
            params![parent_id.as_str(), id],
            |row| row.get(0),
        )?;
        if would_cycle {
            return Err(StoreError::InvalidDomainValue);
        }
        let parent_active: Option<bool> = tx
            .query_row(
                "SELECT active=1 FROM finance_v2_accounts WHERE id=?1",
                [parent_id.as_str()],
                |row| row.get(0),
            )
            .optional()?;
        if parent_active.is_none() {
            return Err(StoreError::MissingReference);
        }
        if !parent_active.unwrap_or(false) {
            return Err(StoreError::InactiveReference);
        }
    }

    tx.execute(
        "INSERT INTO finance_v2_account_history(account_id,revision,name,kind,bean_path,parent_id,active,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            account_revision,
            account.name,
            kind,
            account.bean_path,
            account.parent_id.as_ref().map(|value| value.as_str()),
            if account.active { 1_i64 } else { 0_i64 },
            recorded_at_utc_us,
        ],
    )?;
    if expected_revision.is_none() {
        tx.execute(
            "INSERT INTO finance_v2_accounts(id,revision,name,kind,bean_path,parent_id,active,ever_used) VALUES (?1,?2,?3,?4,?5,?6,?7,0)",
            params![
                id,
                account_revision,
                account.name,
                kind,
                account.bean_path,
                account.parent_id.as_ref().map(|value| value.as_str()),
                if account.active { 1_i64 } else { 0_i64 },
            ],
        )?;
    } else {
        let updated = tx.execute(
            "UPDATE finance_v2_accounts SET revision=?2,name=?3,kind=?4,bean_path=?5,parent_id=?6,active=?7 WHERE id=?1 AND revision=?8",
            params![
                id,
                account_revision,
                account.name,
                kind,
                account.bean_path,
                account.parent_id.as_ref().map(|value| value.as_str()),
                if account.active { 1_i64 } else { 0_i64 },
                expected_revision_i64,
            ],
        )?;
        if updated != 1 {
            return Err(StoreError::StaleRevision);
        }
    }
    Ok(())
}

pub fn read_account_history(tx: &Transaction<'_>, id: &Id) -> Result<Vec<Account>, StoreError> {
    let ever_used: i64 = tx.query_row("SELECT ever_used FROM finance_v2_accounts WHERE id=?1", [id.as_str()], |r| r.get(0)).optional()?.ok_or(StoreError::MissingReference)?;
    let mut stmt = tx.prepare("SELECT revision,name,kind,bean_path,parent_id,active FROM finance_v2_account_history WHERE account_id=?1 ORDER BY revision")?;
    let rows = stmt.query_map([id.as_str()], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,i64>(5)?)))?;
    let mut result=Vec::new();
    for row in rows { let (revision,name,kind,bean_path,parent,active)=row?; result.push(Account {
        id:id.clone(), revision:u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?, name,
        kind:decode_kind(&kind)?, bean_path, parent_id:parent.map(Id::parse).transpose().map_err(|_|StoreError::IncompatibleSchema)?,
        active:active==1, ever_used:ever_used==1,
    }); }
    Ok(result)
}

pub fn restore_account(tx:&Transaction<'_>,id:&Id,source_revision:u64,expected_current_revision:u64,recorded_at_utc_us:i64)->Result<u64,StoreError>{
    let mut account=read_account_history(tx,id)?.into_iter().find(|a|a.revision==source_revision).ok_or(StoreError::MissingReference)?;
    account.revision=expected_current_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    account.active=true;
    save_account(tx,&account,Some(expected_current_revision),recorded_at_utc_us)?;
    Ok(account.revision)
}

pub fn save_via(
    tx: &Transaction<'_>,
    via: &Via,
    expected_revision: Option<u64>,
    recorded_at_utc_us: i64,
) -> Result<(), StoreError> {
    if via.revision == 0 || via.name.trim().is_empty() {
        return Err(StoreError::InvalidDomainValue);
    }
    let id = via.id.as_str();
    let via_revision = i64::try_from(via.revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let expected_revision_i64 = expected_revision
        .map(i64::try_from)
        .transpose()
        .map_err(|_| StoreError::InvalidDomainValue)?;
    let current = tx
        .query_row(
            "SELECT revision FROM finance_v2_vias WHERE id=?1",
            [id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    match (current, expected_revision_i64) {
        (None, None) if via_revision == 1 => {}
        (Some(revision), Some(expected)) if revision == expected && expected.checked_add(1) == Some(via_revision) => {}
        _ => return Err(StoreError::StaleRevision),
    }
    tx.execute(
        "INSERT INTO finance_v2_via_history(via_id,revision,name,active,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5)",
        params![id, via_revision, via.name, if via.active { 1_i64 } else { 0_i64 }, recorded_at_utc_us],
    )?;
    if expected_revision.is_none() {
        tx.execute(
            "INSERT INTO finance_v2_vias(id,revision,name,active) VALUES (?1,?2,?3,?4)",
            params![id, via_revision, via.name, if via.active { 1_i64 } else { 0_i64 }],
        )?;
    } else {
        let updated = tx.execute(
            "UPDATE finance_v2_vias SET revision=?2,name=?3,active=?4 WHERE id=?1 AND revision=?5",
            params![id, via_revision, via.name, if via.active { 1_i64 } else { 0_i64 }, expected_revision_i64],
        )?;
        if updated != 1 {
            return Err(StoreError::StaleRevision);
        }
    }
    Ok(())
}

pub fn read_via_history(tx:&Transaction<'_>,id:&Id)->Result<Vec<Via>,StoreError>{
    let mut stmt=tx.prepare("SELECT revision,name,active FROM finance_v2_via_history WHERE via_id=?1 ORDER BY revision")?;
    let rows=stmt.query_map([id.as_str()],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?;
    let mut result=Vec::new();
    for row in rows { let (revision,name,active)=row?; result.push(Via{id:id.clone(),revision:u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?,name,active:active==1}); }
    Ok(result)
}

pub fn restore_via(tx:&Transaction<'_>,id:&Id,source_revision:u64,expected_current_revision:u64,recorded_at_utc_us:i64)->Result<u64,StoreError>{
    let mut via=read_via_history(tx,id)?.into_iter().find(|v|v.revision==source_revision).ok_or(StoreError::MissingReference)?;
    via.revision=expected_current_revision.checked_add(1).ok_or(StoreError::InvalidDomainValue)?;
    via.active=true;
    save_via(tx,&via,Some(expected_current_revision),recorded_at_utc_us)?;
    Ok(via.revision)
}

pub fn set_account_via(
    tx: &Transaction<'_>,
    account_id: &str,
    via_id: &str,
    revision: u64,
    active: bool,
    recorded_at_utc_us: i64,
) -> Result<(), StoreError> {
    if revision == 0 {
        return Err(StoreError::InvalidDomainValue);
    }
    let revision = i64::try_from(revision).map_err(|_| StoreError::InvalidDomainValue)?;
    let latest: Option<i64> = tx
        .query_row(
            "SELECT MAX(revision) FROM finance_v2_account_via_history WHERE account_id=?1 AND via_id=?2",
            params![account_id, via_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten();
    if latest.map_or(revision != 1, |value| value.checked_add(1) != Some(revision)) {
        return Err(StoreError::StaleRevision);
    }
    require_active_account(tx, account_id)?;
    require_active_via(tx, via_id)?;
    tx.execute(
        "INSERT INTO finance_v2_account_via_history(account_id,via_id,revision,active,recorded_at_utc_us) VALUES (?1,?2,?3,?4,?5)",
        params![account_id, via_id, revision, if active { 1_i64 } else { 0_i64 }, recorded_at_utc_us],
    )?;
    tx.execute("UPDATE finance_v2_account_via_state SET revision=revision+1 WHERE singleton=1",[])?;
    Ok(())
}

pub fn read_account_via_snapshot(tx:&Transaction<'_>)->Result<(u64,Vec<AccountViaBinding>),StoreError>{
    let global:i64=tx.query_row("SELECT revision FROM finance_v2_account_via_state WHERE singleton=1",[],|r|r.get(0))?;
    let mut stmt=tx.prepare("SELECT h.account_id,h.via_id,h.revision,h.active FROM finance_v2_account_via_history h JOIN (SELECT account_id,via_id,MAX(revision) revision FROM finance_v2_account_via_history GROUP BY account_id,via_id) latest USING(account_id,via_id,revision) ORDER BY h.account_id,h.via_id")?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?)))?;
    let mut values=Vec::new();
    for row in rows{let(account,via,revision,active)=row?;values.push(AccountViaBinding{account_id:Id::parse(account).map_err(|_|StoreError::IncompatibleSchema)?,via_id:Id::parse(via).map_err(|_|StoreError::IncompatibleSchema)?,revision:u64::try_from(revision).map_err(|_|StoreError::IncompatibleSchema)?,active:active==1});}
    Ok((u64::try_from(global).map_err(|_|StoreError::IncompatibleSchema)?,values))
}

pub(crate) fn require_active_account(
    tx: &Transaction<'_>,
    account_id: &str,
) -> Result<(), StoreError> {
    let active: Option<bool> = tx
        .query_row(
            "SELECT active=1 FROM finance_v2_accounts WHERE id=?1",
            [account_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()?;
    match active {
        None => Err(StoreError::MissingReference),
        Some(false) => Err(StoreError::InactiveReference),
        Some(true) => Ok(()),
    }
}

pub(crate) fn require_active_via(tx: &Transaction<'_>, via_id: &str) -> Result<(), StoreError> {
    let active: Option<bool> = tx
        .query_row(
            "SELECT active=1 FROM finance_v2_vias WHERE id=?1",
            [via_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()?;
    match active {
        None => Err(StoreError::MissingReference),
        Some(false) => Err(StoreError::InactiveReference),
        Some(true) => Ok(()),
    }
}

fn encode_kind(kind: AccountKind) -> &'static str {
    match kind {
        AccountKind::Assets => "Assets",
        AccountKind::Liabilities => "Liabilities",
        AccountKind::Equity => "Equity",
        AccountKind::Income => "Income",
        AccountKind::Expenses => "Expenses",
    }
}

fn decode_kind(kind:&str)->Result<AccountKind,StoreError>{match kind{"Assets"=>Ok(AccountKind::Assets),"Liabilities"=>Ok(AccountKind::Liabilities),"Equity"=>Ok(AccountKind::Equity),"Income"=>Ok(AccountKind::Income),"Expenses"=>Ok(AccountKind::Expenses),_=>Err(StoreError::IncompatibleSchema)}}
