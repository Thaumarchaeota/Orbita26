//! Transaction-bound Finance v2 storage facade.

use rusqlite::Transaction;

use super::error::{FinanceStorageError, Result};
use super::schema;

/// A view over a transaction opened by the Archive coordinator.
///
/// This type intentionally has no `Connection::open`, path, mutex, or Tauri
/// command.  It can therefore be composed with the coordinator's existing
/// atomic Archive transaction once Finance v2 receives an accepted write
/// contract.
pub struct FinanceStore<'tx> {
    tx: &'tx Transaction<'tx>,
}

impl<'tx> FinanceStore<'tx> {
    pub fn bind(tx: &'tx Transaction<'tx>) -> Self {
        Self { tx }
    }

    /// Installs only the provisional structural schema in this transaction.
    pub fn install_schema(&self) -> Result<()> {
        schema::install_in_transaction(self.tx)
    }

    /// Returns whether the structural tables are already present.
    pub fn schema_installed(&self) -> Result<bool> {
        // Reuse the installer validator so a malformed same-named schema is
        // surfaced as an incompatibility instead of being reported as ready.
        schema::validate_existing_shape(self.tx)
    }

    /// Formal transaction writes are deliberately unavailable until the
    /// accepted amount/account/commodity/posting validation contract exists.
    /// Keeping this refusal in the storage facade prevents callers from
    /// mistaking structural tables for a usable ledger.
    pub fn refuse_formal_write<T>(&self) -> Result<T> {
        Err(FinanceStorageError::ContractNotFinal(
            "Transaction/Posting business fields and invariants are still Proposed (ADR 0014/0038)",
        ))
    }
}
