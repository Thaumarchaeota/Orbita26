//! Errors for the unregistered Finance v2 storage slice.

use std::fmt;

#[derive(Debug)]
pub enum FinanceStorageError {
    Sqlite(rusqlite::Error),
    ContractNotFinal(&'static str),
    IncompatibleSchema(&'static str),
    ForeignKeysDisabled,
}

impl fmt::Display for FinanceStorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(error) => write!(f, "finance storage sqlite error: {error}"),
            Self::ContractNotFinal(message) => write!(f, "finance v2 contract is not final: {message}"),
            Self::IncompatibleSchema(message) => write!(f, "incompatible finance v2 schema: {message}"),
            Self::ForeignKeysDisabled => write!(f, "finance v2 requires PRAGMA foreign_keys = ON"),
        }
    }
}

impl std::error::Error for FinanceStorageError {}

impl From<rusqlite::Error> for FinanceStorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

pub type Result<T> = std::result::Result<T, FinanceStorageError>;
