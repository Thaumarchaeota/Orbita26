//! Structural tests for the unregistered Finance v2 storage seam.
//!
//! These tests intentionally use an in-memory database.  Finance v2 is still
//! Proposed, so the test only proves the provisional storage boundaries and
//! does not exercise the live `.bean` ledger or Archive startup path.

#[path = "../src/finance_v2_db/mod.rs"]
mod finance_v2_db;

use finance_v2_db::{FinanceStorageError, FinanceStore};
use rusqlite::{Connection, Error as SqliteError};

fn in_memory_connection() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys should be enabled for constraint coverage");
    connection
}

#[test]
fn schema_install_is_idempotent_within_one_transaction() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);

    assert!(!store.schema_installed().expect("schema probe should work"));
    store.install_schema().expect("first schema install should work");
    assert!(store.schema_installed().expect("schema probe should work"));
    store
        .install_schema()
        .expect("reinstalling schema should be harmless");
    assert!(store.schema_installed().expect("schema probe should work"));

    transaction.commit().expect("schema transaction should commit");
}

#[test]
fn schema_install_remains_owned_by_the_callers_transaction() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    FinanceStore::bind(&transaction)
        .install_schema()
        .expect("schema install should work");
    transaction.rollback().expect("schema transaction should roll back");

    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM main.sqlite_master
             WHERE type = 'table' AND name LIKE 'finance_%'",
            [],
            |row| row.get(0),
        )
        .expect("schema inspection should work");
    assert_eq!(table_count, 0);
}

#[test]
fn installed_probe_is_read_only_when_foreign_keys_are_disabled() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    FinanceStore::bind(&transaction)
        .install_schema()
        .expect("schema install should work");
    transaction.commit().expect("schema transaction should commit");

    connection
        .pragma_update(None, "foreign_keys", false)
        .expect("foreign keys should be disabled for the probe");
    let transaction = connection.transaction().expect("transaction should open");
    assert!(FinanceStore::bind(&transaction)
        .schema_installed()
        .expect("schema probe should work"));
    transaction.rollback().expect("probe transaction should roll back");
}

#[test]
fn retained_posting_index_has_the_canonical_two_columns() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    FinanceStore::bind(&transaction)
        .install_schema()
        .expect("schema install should work");

    let (unique, partial): (i64, i64) = transaction
        .query_row(
            "SELECT \"unique\", partial
             FROM pragma_index_list('finance_postings', 'main')
             WHERE name = 'idx_finance_postings_transaction'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("retained index metadata should exist");
    assert_eq!((unique, partial), (0, 0));

    let mut statement = transaction
        .prepare(
            "SELECT name
             FROM pragma_index_info('idx_finance_postings_transaction', 'main')
             ORDER BY seqno",
        )
        .expect("retained index metadata should be readable");
    let columns = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("retained index columns should be readable")
        .collect::<std::result::Result<Vec<_>, _>>()
        .expect("retained index columns should collect");
    assert_eq!(
        columns,
        vec!["transaction_id".to_string(), "position".to_string()]
    );

    drop(statement);
    transaction.rollback().expect("schema transaction should roll back");
}

#[test]
fn posting_requires_parent_and_unique_position_per_transaction() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);
    store.install_schema().expect("schema install should work");

    transaction
        .execute(
            "INSERT INTO finance_transactions (id, revision) VALUES (?1, ?2)",
            ("tx-1", 1_i64),
        )
        .expect("parent transaction should insert");
    transaction
        .execute(
            "INSERT INTO finance_postings (id, transaction_id, position) VALUES (?1, ?2, ?3)",
            ("posting-1", "tx-1", 0_i64),
        )
        .expect("first posting should insert");

    let delete_parent = transaction.execute(
        "DELETE FROM finance_transactions WHERE id = ?1",
        ["tx-1"],
    );
    assert!(matches!(delete_parent, Err(SqliteError::SqliteFailure(_, _))));

    let duplicate_position = transaction.execute(
        "INSERT INTO finance_postings (id, transaction_id, position) VALUES (?1, ?2, ?3)",
        ("posting-2", "tx-1", 0_i64),
    );
    assert!(matches!(duplicate_position, Err(SqliteError::SqliteFailure(_, _))));

    let orphan = transaction.execute(
        "INSERT INTO finance_postings (id, transaction_id, position) VALUES (?1, ?2, ?3)",
        ("posting-orphan", "missing", 0_i64),
    );
    assert!(matches!(orphan, Err(SqliteError::SqliteFailure(_, _))));

    transaction.rollback().expect("constraint transaction should roll back");
}

#[test]
fn identity_and_ordering_checks_reject_invalid_values() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);
    store.install_schema().expect("schema install should work");

    for (id, revision) in [
        ("", 1_i64),
        ("   ", 1_i64),
        ("tx-zero-revision", 0_i64),
    ] {
        let result = transaction.execute(
            "INSERT INTO finance_transactions (id, revision) VALUES (?1, ?2)",
            (id, revision),
        );
        assert!(result.is_err(), "invalid transaction identity should be rejected");
    }

    transaction
        .execute(
            "INSERT INTO finance_transactions (id, revision) VALUES (?1, ?2)",
            ("tx-valid", 1_i64),
        )
        .expect("valid transaction identity should insert");
    let negative_position = transaction.execute(
        "INSERT INTO finance_postings (id, transaction_id, position) VALUES (?1, ?2, ?3)",
        ("posting-negative", "tx-valid", -1_i64),
    );
    assert!(negative_position.is_err(), "negative position should be rejected");
    let blank_posting_id = transaction.execute(
        "INSERT INTO finance_postings (id, transaction_id, position) VALUES (?1, ?2, ?3)",
        ("  ", "tx-valid", 0_i64),
    );
    assert!(blank_posting_id.is_err(), "blank posting id should be rejected");

    transaction.rollback().expect("identity transaction should roll back");
}

#[test]
fn malformed_existing_table_is_not_accepted_as_installed_schema() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    transaction
        .execute(
            "CREATE TABLE finance_transactions (id TEXT PRIMARY KEY NOT NULL)",
            [],
        )
        .expect("malformed fixture table should create");

    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.install_schema(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));

    transaction.rollback().expect("malformed schema transaction should roll back");
}

#[test]
fn schema_install_refuses_connections_with_foreign_keys_disabled() {
    let mut connection = Connection::open_in_memory().expect("in-memory SQLite should open");
    connection
        .pragma_update(None, "foreign_keys", false)
        .expect("foreign keys should be disabled for this fixture");
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);

    assert!(matches!(
        store.install_schema(),
        Err(FinanceStorageError::ForeignKeysDisabled)
    ));
    let table_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'finance_%'",
            [],
            |row| row.get(0),
        )
        .expect("schema probe should work");
    assert_eq!(table_count, 0);

    transaction.rollback().expect("foreign key transaction should roll back");
}

#[test]
fn formal_write_is_explicitly_refused_until_contract_is_final() {
    let mut connection = in_memory_connection();
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);

    let result: finance_v2_db::Result<()> = store.refuse_formal_write();
    assert!(matches!(
        result,
        Err(FinanceStorageError::ContractNotFinal(_))
    ));

    transaction.rollback().expect("refusal transaction should roll back");
}
