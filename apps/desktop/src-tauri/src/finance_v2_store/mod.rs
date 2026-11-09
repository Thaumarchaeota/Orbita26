//! Isolated Finance v2 persistence primitives. This module is not registered
//! by the production Tauri crate root.

pub mod accounts;
pub mod evidence;
pub mod l0;
pub mod schema;
pub mod sources;
pub mod treatments;
pub mod calibrations;
pub mod read;
pub mod commit;

#[derive(Debug)]
pub enum StoreError {
    Sqlite(rusqlite::Error),
    IncompatibleSchema,
    UnsupportedSchemaVersion,
    StaleRevision,
    MissingReference,
    InactiveReference,
    ImmutableAccountKind,
    InvalidDomainValue,
    DuplicateEvidenceOccurrence,
    ForeignKeysDisabled,
    InvalidEvidenceAllocation,
    OperationConflict,
    GenerationConflict,
}

impl From<rusqlite::Error> for StoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Sqlite(_) => "Finance v2 storage operation failed",
            Self::IncompatibleSchema => "Finance v2 database schema is incompatible",
            Self::UnsupportedSchemaVersion => "Finance v2 database schema version is unsupported",
            Self::StaleRevision => "Finance v2 revision is stale",
            Self::MissingReference => "Finance v2 referenced record is missing",
            Self::InactiveReference => "Finance v2 referenced record is inactive",
            Self::ImmutableAccountKind => "Finance v2 account kind is immutable after use",
            Self::InvalidDomainValue => "Finance v2 value failed validation",
            Self::DuplicateEvidenceOccurrence => "Finance v2 evidence occurrence already exists",
            Self::ForeignKeysDisabled => "Finance v2 database foreign-key enforcement is disabled",
            Self::InvalidEvidenceAllocation => "Finance v2 evidence allocation is invalid",
            Self::OperationConflict => "Finance v2 operation conflicts with an existing operation",
            Self::GenerationConflict => "Finance v2 ledger generation is stale",
        };
        formatter.write_str(message)
    }
}
