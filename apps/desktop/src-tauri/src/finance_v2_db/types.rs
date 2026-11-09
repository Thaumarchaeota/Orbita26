//! Structural identities only.  Finance business fields are deliberately absent.

/// Stable identity and optimistic-concurrency metadata for a transaction row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransactionIdentity {
    pub id: String,
    pub revision: i64,
    /// `Some` marks a retained historical row; the deletion reason/transition
    /// contract is intentionally not modeled until Finance v2 is accepted.
    pub deleted_at_utc: Option<String>,
}

/// Stable identity and ordering metadata for a posting row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostingIdentity {
    pub id: String,
    pub transaction_id: String,
    pub position: i64,
}
