#[path = "../src/finance_v2_domain/mod.rs"]
mod finance_v2_domain;
#[path = "../src/finance_v2_projection/mod.rs"]
mod finance_v2_projection;
#[path = "../src/finance_v2_store/mod.rs"]
mod finance_v2_store;

use finance_v2_domain::{
    Account, AccountKind, Amount, BusinessDate, BusinessTime, CommodityCode, FactStatus, Id,
    L0Fact, Provenance, Quantity,
};
use finance_v2_store::{
    accounts::save_account,
    commit::{commit_once_verified, find_job_by_operation, find_receipt},
    l0::{append_l0_version, L0ChangeOrigin},
    schema,
    StoreError,
};
use rusqlite::Connection;
use std::cell::Cell;
use std::rc::Rc;

struct FixtureIds {
    operation: Id,
    receipt: Id,
    job: Id,
    expense: Id,
    cash: Id,
    fact: Id,
}

impl FixtureIds {
    fn new() -> Self {
        Self {
            operation: Id::new(),
            receipt: Id::new(),
            job: Id::new(),
            expense: Id::new(),
            cash: Id::new(),
            fact: Id::new(),
        }
    }
}

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().expect("open in-memory SQLite");
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .expect("enable SQLite foreign keys");
    let tx = connection.transaction().expect("start schema transaction");
    schema::install(&tx).expect("install Finance v2 schema");
    tx.commit().expect("commit schema");
    connection
}

fn write_valid_fact(
    tx: &rusqlite::Transaction<'_>,
    ids: &FixtureIds,
) -> Result<serde_json::Value, StoreError> {
    save_account(
        tx,
        &Account {
            id: ids.expense.clone(),
            revision: 1,
            name: "Expenses:Food".into(),
            kind: AccountKind::Expenses,
            bean_path: None,
            parent_id: None,
            active: true,
            ever_used: false,
        },
        None,
        100,
    )?;
    save_account(
        tx,
        &Account {
            id: ids.cash.clone(),
            revision: 1,
            name: "Assets:Cash".into(),
            kind: AccountKind::Assets,
            bean_path: None,
            parent_id: None,
            active: true,
            ever_used: false,
        },
        None,
        100,
    )?;
    let date = BusinessDate::parse("2026-10-20").expect("valid fixture date");
    let quantity = Quantity::new(
        Amount::parse_decimal("12.50").expect("valid fixture amount"),
        CommodityCode::parse("USD").expect("valid fixture commodity"),
    );
    let fact = L0Fact {
        id: ids.fact.clone(),
        revision: 1,
        status: FactStatus::Active,
        effective_date: date,
        business_time: BusinessTime::date(date),
        positive_account_id: ids.expense.clone(),
        positive: quantity.clone(),
        negative_account_id: ids.cash.clone(),
        negative: quantity,
        via_id: None,
        title: "Synthetic meal".into(),
        notes: "Integration test fixture".into(),
        provenance: Provenance::Manual {
            created_at_utc_micros: 100,
        },
    };
    append_l0_version(tx, &fact, None, 100, L0ChangeOrigin::CreatedManual)?;
    Ok(serde_json::json!({ "factId": ids.fact.as_str() }))
}

#[test]
fn same_operation_and_hash_returns_original_receipt_without_replaying_writes() {
    let mut connection = database();
    let ids = FixtureIds::new();
    let write_count = Rc::new(Cell::new(0));
    let first_count = Rc::clone(&write_count);
    let first = commit_once_verified(
        &mut connection,
        &ids.operation,
        &ids.receipt,
        &ids.job,
        &"a".repeat(64),
        0,
        200,
        |tx| {
            first_count.set(first_count.get() + 1);
            write_valid_fact(tx, &ids)
        },
        |_, _, _| Ok(()),
    )
    .expect("first commit");

    let retry_count = Rc::clone(&write_count);
    let retry = commit_once_verified(
        &mut connection,
        &ids.operation,
        &Id::new(),
        &Id::new(),
        &"a".repeat(64),
        0,
        300,
        |_| {
            retry_count.set(retry_count.get() + 1);
            Err(StoreError::InvalidDomainValue)
        },
        |_, _, _| Err(StoreError::InvalidDomainValue),
    )
    .expect("idempotent retry returns the original result");

    assert!(!first.already_committed);
    assert!(retry.already_committed);
    assert_eq!(retry.receipt, first.receipt);
    assert_eq!(retry.job, first.job);
    assert_eq!(write_count.get(), 1, "retry must not invoke the writer");
}

#[test]
fn same_operation_with_different_hash_is_rejected_without_writes() {
    let mut connection = database();
    let ids = FixtureIds::new();
    commit_once_verified(
        &mut connection,
        &ids.operation,
        &ids.receipt,
        &ids.job,
        &"b".repeat(64),
        0,
        200,
        |tx| write_valid_fact(tx, &ids),
        |_, _, _| Ok(()),
    )
    .expect("first commit");

    let callback_ran = Cell::new(false);
    let result = commit_once_verified(
        &mut connection,
        &ids.operation,
        &Id::new(),
        &Id::new(),
        &"c".repeat(64),
        1,
        300,
        |_| {
            callback_ran.set(true);
            Ok(serde_json::Value::Null)
        },
        |_, _, _| Ok(()),
    );

    assert!(matches!(result, Err(StoreError::OperationConflict)));
    assert!(!callback_ran.get(), "conflicting retry must not invoke the writer");
    assert_eq!(connection.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert!(find_receipt(&connection, &ids.operation).unwrap().is_some());
    assert!(find_job_by_operation(&connection, &ids.operation).unwrap().is_some());
}

#[test]
fn projection_verifier_failure_rolls_back_facts_generation_receipt_and_job() {
    let mut connection = database();
    let ids = FixtureIds::new();
    let result = commit_once_verified(
        &mut connection,
        &ids.operation,
        &ids.receipt,
        &ids.job,
        &"d".repeat(64),
        0,
        200,
        |tx| write_valid_fact(tx, &ids),
        |_, _, _| Err(StoreError::InvalidDomainValue),
    );

    assert!(matches!(result, Err(StoreError::InvalidDomainValue)));
    assert_eq!(connection.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    let account_count = connection.query_row("SELECT COUNT(*) FROM finance_v2_accounts", [], |r| r.get::<_, i64>(0)).unwrap();
    let fact_count = connection.query_row("SELECT COUNT(*) FROM finance_v2_l0_versions", [], |r| r.get::<_, i64>(0)).unwrap();
    let receipt_count = connection.query_row("SELECT COUNT(*) FROM finance_v2_commit_receipts", [], |r| r.get::<_, i64>(0)).unwrap();
    let job_count = connection.query_row("SELECT COUNT(*) FROM finance_v2_materialization_jobs", [], |r| r.get::<_, i64>(0)).unwrap();
    assert_eq!((account_count, fact_count, receipt_count, job_count), (0, 0, 0, 0));
    assert!(find_receipt(&connection, &ids.operation).unwrap().is_none());
    assert!(find_job_by_operation(&connection, &ids.operation).unwrap().is_none());
}
