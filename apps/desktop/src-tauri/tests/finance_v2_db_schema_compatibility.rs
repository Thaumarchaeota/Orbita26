//! Independent adversarial fixtures for the unregistered Finance v2 schema.
//!
//! These cases deliberately construct SQLite metadata that can fool a
//! text-only validator.  They are confined to in-memory connections and do
//! not exercise the live Archive or current Finance ledger.

#[path = "../src/finance_v2_db/mod.rs"]
mod finance_v2_db;

use finance_v2_db::{FinanceStorageError, FinanceStore};
use rusqlite::Connection;

fn connection() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
    connection
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys should be enabled");
    connection
}

fn valid_sql_without_named_index(connection: &Connection) {
    connection
        .execute_batch(
            "CREATE TABLE finance_transactions (
                 id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
                 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                 deleted_at_utc TEXT
             );
             CREATE TABLE finance_postings (
                 id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
                 transaction_id TEXT NOT NULL,
                 position INTEGER NOT NULL CHECK (position >= 0),
                 FOREIGN KEY (transaction_id) REFERENCES finance_transactions(id) ON DELETE RESTRICT,
                 UNIQUE (transaction_id, position)
             );",
        )
        .expect("valid fixture should create");
}

fn add_required_named_index(connection: &Connection) {
    connection
        .execute(
            "CREATE INDEX idx_finance_postings_transaction
             ON finance_postings(transaction_id, position)",
            [],
        )
        .expect("required named index should create");
}

#[test]
fn text_that_mentions_constraints_cannot_replace_real_primary_key_and_fk() {
    let mut connection = connection();
    let transaction = connection.transaction().expect("transaction should open");
    transaction
        .execute_batch(
            "CREATE TABLE finance_transactions (
                 id TEXT NOT NULL DEFAULT 'PRIMARY KEY CHECK(length(trim(id))>0)',
                 revision INTEGER NOT NULL DEFAULT 1,
                 deleted_at_utc TEXT
             );
             CREATE TABLE finance_postings (
                 id TEXT NOT NULL DEFAULT 'FOREIGN KEY ... ON DELETE RESTRICT UNIQUE',
                 transaction_id TEXT NOT NULL,
                 position INTEGER NOT NULL DEFAULT 0
             );",
        )
        .expect("deceptive fixture should create");
    let store = FinanceStore::bind(&transaction);

    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn cascade_fk_is_rejected_even_when_sql_contains_restrict_elsewhere() {
    let mut connection = connection();
    let transaction = connection.transaction().expect("transaction should open");
    transaction
        .execute_batch(
            "CREATE TABLE finance_transactions (
                 id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
                 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                 deleted_at_utc TEXT
             );
             CREATE TABLE finance_postings (
                 id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
                 transaction_id TEXT NOT NULL,
                 position INTEGER NOT NULL CHECK (position >= 0),
                 FOREIGN KEY (transaction_id) REFERENCES finance_transactions(id) ON DELETE CASCADE,
                 UNIQUE (transaction_id, position),
                 note TEXT DEFAULT 'ON DELETE RESTRICT'
             );",
        )
        .expect("cascade fixture should create");
    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn partial_or_extra_unique_index_is_not_a_position_constraint() {
    let mut connection = connection();
    valid_sql_without_named_index(&connection);
    let transaction = connection.transaction().expect("transaction should open");
    transaction
        .execute(
            "CREATE UNIQUE INDEX extra_unique_position ON finance_postings(transaction_id) WHERE position >= 0",
            [],
        )
        .expect("partial index should create");
    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn target_trigger_is_rejected_without_running_it() {
    let mut connection = connection();
    valid_sql_without_named_index(&connection);
    let transaction = connection.transaction().expect("transaction should open");
    transaction
        .execute_batch(
            "CREATE TRIGGER audit_finance_transaction
             AFTER INSERT ON finance_transactions
             BEGIN SELECT 1; END;",
        )
        .expect("trigger fixture should create");
    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn named_index_owned_by_another_table_blocks_install_without_partial_schema() {
    let mut connection = connection();
    let transaction = connection.transaction().expect("transaction should open");
    transaction
        .execute_batch(
            "CREATE TABLE unrelated (value TEXT);
             CREATE INDEX idx_finance_postings_transaction ON unrelated(value);",
        )
        .expect("unrelated index fixture should create");
    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.install_schema(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    let finance_tables: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'finance_%'",
            [],
            |row| row.get(0),
        )
        .expect("table count should query");
    assert_eq!(finance_tables, 0, "failed install must not create a partial schema");
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn supported_case_whitespace_and_if_not_exists_variants_remain_compatible() {
    let mut connection = connection();
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS FINANCE_TRANSACTIONS(
                 ID text primary key not null check(length(trim(ID))>0),
                 REVISION integer not null default 1 check(REVISION>=1),
                 DELETED_AT_UTC text
             )
             ;
             CREATE TABLE FINANCE_POSTINGS (
                 ID TEXT PRIMARY KEY NOT NULL CHECK (length(trim(ID)) > 0),
                 TRANSACTION_ID TEXT NOT NULL,
                 POSITION INTEGER NOT NULL CHECK (POSITION >= 0),
                 FOREIGN KEY (TRANSACTION_ID) REFERENCES FINANCE_TRANSACTIONS(ID) ON DELETE RESTRICT,
                 UNIQUE (TRANSACTION_ID, POSITION)
             )
             ;
             CREATE INDEX IDX_FINANCE_POSTINGS_TRANSACTION
                 ON FINANCE_POSTINGS(TRANSACTION_ID, POSITION)",
        )
        .expect("supported formatting variant should create");
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);
    assert!(store.schema_installed().expect("schema probe should work"));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn equivalent_but_unsupported_check_expression_is_rejected() {
    let mut connection = connection();
    connection
        .execute_batch(
            "CREATE TABLE finance_transactions (
                 id TEXT PRIMARY KEY NOT NULL CHECK (id <> ''),
                 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
                 deleted_at_utc TEXT
             );
             CREATE TABLE finance_postings (
                 id TEXT PRIMARY KEY NOT NULL CHECK (id <> ''),
                 transaction_id TEXT NOT NULL,
                 position INTEGER NOT NULL CHECK (position > -1),
                 FOREIGN KEY (transaction_id) REFERENCES finance_transactions(id) ON DELETE RESTRICT,
                 UNIQUE (transaction_id, position)
             );",
        )
        .expect("alternate check fixture should create");
    add_required_named_index(&connection);
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn temp_trigger_on_target_table_is_rejected() {
    let mut connection = connection();
    valid_sql_without_named_index(&connection);
    add_required_named_index(&connection);
    connection
        .execute_batch(
            "CREATE TEMP TRIGGER target_temp_trigger
             AFTER INSERT ON main.finance_transactions
             BEGIN SELECT 1; END;",
        )
        .expect("temp trigger fixture should create");
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);
    assert!(matches!(
        store.schema_installed(),
        Err(FinanceStorageError::IncompatibleSchema(_))
    ));
    transaction.rollback().expect("fixture should roll back");
}

#[test]
fn unrelated_trigger_and_index_do_not_block_compatible_schema() {
    let mut connection = connection();
    valid_sql_without_named_index(&connection);
    add_required_named_index(&connection);
    connection
        .execute_batch(
            "CREATE TABLE unrelated(value TEXT);
             CREATE INDEX unrelated_value_idx ON unrelated(value);
             CREATE TRIGGER unrelated_trigger AFTER INSERT ON unrelated
             BEGIN SELECT 1; END;",
        )
        .expect("unrelated objects should create");
    let transaction = connection.transaction().expect("transaction should open");
    let store = FinanceStore::bind(&transaction);
    assert!(store.schema_installed().expect("schema probe should work"));
    transaction.rollback().expect("fixture should roll back");
}

