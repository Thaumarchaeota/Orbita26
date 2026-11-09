//! Finance v2 structural schema.
//!
//! The exact Transaction/Posting columns remain open in ADR 0014 and ADR 0038.
//! Consequently this DDL contains only identity, lifecycle/version, ownership,
//! and ordering columns.  It is intentionally not registered with Archive V9:
//! Finance v2 is still Proposed and the running `.bean` ledger remains canonical.

use rusqlite::{OptionalExtension, Transaction};

use super::error::{FinanceStorageError, Result};

const TRANSACTIONS_TABLE: &str = "finance_transactions";
const POSTINGS_TABLE: &str = "finance_postings";
const POSTINGS_TRANSACTION_INDEX: &str = "idx_finance_postings_transaction";

const STRUCTURAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS finance_postings (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    transaction_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    FOREIGN KEY (transaction_id) REFERENCES finance_transactions(id) ON DELETE RESTRICT,
    UNIQUE (transaction_id, position)
);

CREATE INDEX IF NOT EXISTS idx_finance_postings_transaction
    ON finance_postings(transaction_id, position);
"#;

#[derive(Debug, Eq, PartialEq)]
enum SqlToken {
    Identifier(String),
    Integer(String),
    StringLiteral(String),
    Punctuation(char),
}

#[derive(Debug, Eq, PartialEq)]
struct ColumnMetadata {
    name: String,
    data_type: String,
    not_null: bool,
    default_value: Option<String>,
    primary_key_position: i64,
}

#[derive(Debug)]
struct IndexMetadata {
    name: String,
    unique: bool,
    origin: String,
    partial: bool,
}

fn incompatible(message: &'static str) -> FinanceStorageError {
    FinanceStorageError::IncompatibleSchema(message)
}

fn schema_object_type(tx: &Transaction<'_>, name: &str) -> Result<Option<String>> {
    tx.query_row(
        "SELECT type
         FROM main.sqlite_master
         WHERE name = ?1 COLLATE NOCASE
           AND type IN ('table', 'view', 'index')",
        [name],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

fn table_sql(tx: &Transaction<'_>, name: &str) -> Result<Option<String>> {
    tx.query_row(
        "SELECT sql
         FROM main.sqlite_master
         WHERE type = 'table' AND name = ?1 COLLATE NOCASE",
        [name],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

fn table_metadata(tx: &Transaction<'_>, table: &str) -> Result<Vec<ColumnMetadata>> {
    let mut statement = tx.prepare(
        "SELECT name, type, \"notnull\", dflt_value, pk
         FROM pragma_table_info(?1, 'main')
         ORDER BY cid",
    )?;
    let rows = statement.query_map([table], |row| {
        Ok(ColumnMetadata {
            name: row.get(0)?,
            data_type: row.get(1)?,
            not_null: row.get::<_, i64>(2)? != 0,
            default_value: row.get(3)?,
            primary_key_position: row.get(4)?,
        })
    })?;
    let metadata = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(metadata)
}

fn column(
    name: &str,
    data_type: &str,
    not_null: bool,
    default_value: Option<&str>,
    primary_key_position: i64,
) -> ColumnMetadata {
    ColumnMetadata {
        name: name.to_string(),
        data_type: data_type.to_string(),
        not_null,
        default_value: default_value.map(str::to_string),
        primary_key_position,
    }
}

fn has_expected_columns(tx: &Transaction<'_>, table: &str) -> Result<bool> {
    let expected = match table {
        TRANSACTIONS_TABLE => vec![
            column("id", "TEXT", true, None, 1),
            column("revision", "INTEGER", true, Some("1"), 0),
            column("deleted_at_utc", "TEXT", false, None, 0),
        ],
        POSTINGS_TABLE => vec![
            column("id", "TEXT", true, None, 1),
            column("transaction_id", "TEXT", true, None, 0),
            column("position", "INTEGER", true, None, 0),
        ],
        _ => return Ok(false),
    };
    let actual = table_metadata(tx, table)?;
    Ok(actual.len() == expected.len()
        && actual.iter().zip(expected.iter()).all(|(actual, expected)| {
            actual.name.eq_ignore_ascii_case(&expected.name)
                && actual.data_type.eq_ignore_ascii_case(&expected.data_type)
                && actual.not_null == expected.not_null
                && actual.default_value == expected.default_value
                && actual.primary_key_position == expected.primary_key_position
        }))
}

fn tokenize_sql(sql: &str) -> Option<Vec<SqlToken>> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii_whitespace() {
            index += 1;
            continue;
        }
        if (byte == b'-' && bytes.get(index + 1) == Some(&b'-'))
            || (byte == b'/' && bytes.get(index + 1) == Some(&b'*'))
        {
            return None;
        }
        if byte.is_ascii_alphabetic() || byte == b'_' {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push(SqlToken::Identifier(sql[start..index].to_ascii_lowercase()));
            continue;
        }
        if byte.is_ascii_digit() {
            let start = index;
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            tokens.push(SqlToken::Integer(sql[start..index].to_string()));
            continue;
        }
        if byte == b'\'' {
            index += 1;
            let mut value = String::new();
            let mut terminated = false;
            while index < bytes.len() {
                if bytes[index] == b'\'' {
                    if bytes.get(index + 1) == Some(&b'\'') {
                        value.push('\'');
                        index += 2;
                    } else {
                        index += 1;
                        terminated = true;
                        break;
                    }
                } else {
                    let character = sql[index..].chars().next()?;
                    value.push(character);
                    index += character.len_utf8();
                }
            }
            if !terminated {
                return None;
            }
            tokens.push(SqlToken::StringLiteral(value));
            continue;
        }
        if matches!(byte, b'"' | b'`' | b'[' | b']') || !byte.is_ascii_punctuation() {
            return None;
        }
        tokens.push(SqlToken::Punctuation(char::from(byte)));
        index += 1;
    }

    Some(tokens)
}

fn is_identifier(token: Option<&SqlToken>, expected: &str) -> bool {
    matches!(token, Some(SqlToken::Identifier(value)) if value == expected)
}

fn normalized_table_tokens(sql: &str) -> Option<Vec<SqlToken>> {
    let mut tokens = tokenize_sql(sql)?;
    if matches!(tokens.last(), Some(SqlToken::Punctuation(';'))) {
        tokens.pop();
    }
    if !is_identifier(tokens.first(), "create") || !is_identifier(tokens.get(1), "table") {
        return None;
    }
    if is_identifier(tokens.get(2), "if")
        && is_identifier(tokens.get(3), "not")
        && is_identifier(tokens.get(4), "exists")
    {
        tokens.drain(2..5);
    }
    Some(tokens)
}

fn canonical_table_tokens(table: &str) -> Option<Vec<SqlToken>> {
    STRUCTURAL_SCHEMA.split_inclusive(';').find_map(|statement| {
        let tokens = normalized_table_tokens(statement)?;
        if is_identifier(tokens.get(2), table) {
            Some(tokens)
        } else {
            None
        }
    })
}

fn has_canonical_ddl(table: &str, sql: &str) -> bool {
    match (canonical_table_tokens(table), normalized_table_tokens(sql)) {
        (Some(expected), Some(actual)) => actual == expected,
        _ => false,
    }
}

fn index_metadata(tx: &Transaction<'_>, table: &str) -> Result<Vec<IndexMetadata>> {
    let mut statement = tx.prepare(
        "SELECT name, \"unique\", origin, partial
         FROM pragma_index_list(?1, 'main')
         ORDER BY seq",
    )?;
    let rows = statement.query_map([table], |row| {
        Ok(IndexMetadata {
            name: row.get(0)?,
            unique: row.get::<_, i64>(1)? != 0,
            origin: row.get(2)?,
            partial: row.get::<_, i64>(3)? != 0,
        })
    })?;
    let metadata = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(metadata)
}

fn index_columns(tx: &Transaction<'_>, index: &str) -> Result<Vec<Option<String>>> {
    let mut statement = tx.prepare(
        "SELECT name
         FROM pragma_index_info(?1, 'main')
         ORDER BY seqno",
    )?;
    let rows = statement.query_map([index], |row| row.get(0))?;
    let columns = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(columns)
}

fn columns_match(actual: &[Option<String>], expected: &[&str]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected.iter())
            .all(|(actual, expected)| {
                matches!(actual.as_deref(), Some(actual) if actual.eq_ignore_ascii_case(expected))
            })
}

fn reserved_index_has_expected_owner(tx: &Transaction<'_>) -> Result<bool> {
    let mut statement = tx.prepare(
        "SELECT type, tbl_name
         FROM main.sqlite_master
         WHERE name = ?1 COLLATE NOCASE
           AND type IN ('table', 'view', 'index')",
    )?;
    let rows = statement.query_map([POSTINGS_TRANSACTION_INDEX], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let objects = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(objects.iter().all(|(kind, table)| {
        kind == "index" && table.eq_ignore_ascii_case(POSTINGS_TABLE)
    }))
}

fn has_expected_indexes(tx: &Transaction<'_>) -> Result<bool> {
    let mut transaction_primary_key_indexes = 0;
    for index in index_metadata(tx, TRANSACTIONS_TABLE)? {
        let columns = index_columns(tx, &index.name)?;
        if index.unique
            && !index.partial
            && index.origin == "pk"
            && columns_match(&columns, &["id"])
        {
            transaction_primary_key_indexes += 1;
        } else if index.unique {
            return Ok(false);
        }
    }
    if transaction_primary_key_indexes != 1 {
        return Ok(false);
    }

    let mut posting_primary_key_indexes = 0;
    let mut posting_position_indexes = 0;
    for index in index_metadata(tx, POSTINGS_TABLE)? {
        let columns = index_columns(tx, &index.name)?;
        if index.unique
            && !index.partial
            && index.origin == "pk"
            && columns_match(&columns, &["id"])
        {
            posting_primary_key_indexes += 1;
        } else if index.unique
            && !index.partial
            && index.origin == "u"
            && columns_match(&columns, &["transaction_id", "position"])
        {
            posting_position_indexes += 1;
        } else if index.unique {
            return Ok(false);
        }

        if index.name.eq_ignore_ascii_case(POSTINGS_TRANSACTION_INDEX)
            && (index.unique
                || index.partial
                || !columns_match(&columns, &["transaction_id", "position"]))
        {
            return Ok(false);
        }
    }

    Ok(posting_primary_key_indexes == 1 && posting_position_indexes == 1)
}

fn has_expected_foreign_key(tx: &Transaction<'_>) -> Result<bool> {
    let mut statement = tx.prepare(
        "SELECT id, seq, \"table\", \"from\", \"to\", on_delete
         FROM pragma_foreign_key_list(?1, 'main')
         ORDER BY id, seq",
    )?;
    let rows = statement.query_map([POSTINGS_TABLE], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;
    let foreign_keys = rows.collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(matches!(foreign_keys.as_slice(), [(0, 0, parent, child, target, on_delete)]
        if parent.eq_ignore_ascii_case(TRANSACTIONS_TABLE)
            && child.eq_ignore_ascii_case("transaction_id")
            && target.eq_ignore_ascii_case("id")
            && on_delete.eq_ignore_ascii_case("restrict")))
}

fn has_target_triggers(tx: &Transaction<'_>) -> Result<bool> {
    let count: i64 = tx.query_row(
        "SELECT COUNT(*)
         FROM (
             SELECT tbl_name FROM main.sqlite_master WHERE type = 'trigger'
             UNION ALL
             SELECT tbl_name FROM temp.sqlite_master WHERE type = 'trigger'
         )
         WHERE lower(tbl_name) IN (lower(?1), lower(?2))",
        [TRANSACTIONS_TABLE, POSTINGS_TABLE],
        |row| row.get(0),
    )?;
    Ok(count != 0)
}

pub(crate) fn validate_existing_shape(tx: &Transaction<'_>) -> Result<bool> {
    // Namespace conflicts must be rejected even when neither target table is
    // present; otherwise IF NOT EXISTS could leave a partially installed schema.
    if !reserved_index_has_expected_owner(tx)? {
        return Err(incompatible(
            "the reserved Finance v2 index name belongs to another table",
        ));
    }
    let transaction_object = schema_object_type(tx, TRANSACTIONS_TABLE)?;
    let posting_object = schema_object_type(tx, POSTINGS_TABLE)?;
    if matches!(transaction_object.as_deref(), Some(kind) if kind != "table")
        || matches!(posting_object.as_deref(), Some(kind) if kind != "table")
    {
        return Err(incompatible(
            "a Finance v2 structural name belongs to a non-table object",
        ));
    }

    let transaction_sql = table_sql(tx, TRANSACTIONS_TABLE)?;
    let posting_sql = table_sql(tx, POSTINGS_TABLE)?;
    match (transaction_sql, posting_sql) {
        (None, None) => Ok(false),
        (Some(_), None) | (None, Some(_)) => Err(incompatible(
            "only one Finance v2 structural table exists",
        )),
        (Some(transaction_sql), Some(posting_sql)) => {
            // SPEC-0005 deliberately accepts only this module's token shape.
            // SQLite metadata proves the constraints that SQL text alone cannot.
            if !has_expected_columns(tx, TRANSACTIONS_TABLE)?
                || !has_expected_columns(tx, POSTINGS_TABLE)?
                || !has_canonical_ddl(TRANSACTIONS_TABLE, &transaction_sql)
                || !has_canonical_ddl(POSTINGS_TABLE, &posting_sql)
                || !has_expected_indexes(tx)?
                || !has_expected_foreign_key(tx)?
                || has_target_triggers(tx)?
            {
                return Err(incompatible(
                    "same-named tables do not match the supported structural schema",
                ));
            }
            Ok(true)
        }
    }
}

/// Installs the provisional structural tables inside the caller's Archive
/// transaction.  The caller owns commit/rollback and supplies the shared
/// coordinator transaction; this function never opens a connection or starts
/// an independent transaction.
pub fn install_in_transaction(tx: &Transaction<'_>) -> Result<()> {
    let foreign_keys: i64 = tx.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys != 1 {
        return Err(FinanceStorageError::ForeignKeysDisabled);
    }
    // Validate before executing any idempotent DDL so an incompatible partial
    // schema is reported without repairing or otherwise mutating it.
    validate_existing_shape(tx)?;
    tx.execute_batch(STRUCTURAL_SCHEMA)?;
    validate_existing_shape(tx)?;
    Ok(())
}

pub(crate) const fn schema_description() -> &'static str {
    "finance_transactions + finance_postings structural tables"
}
