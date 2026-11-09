//! Unregistered Finance v2 storage core.
//!
//! This module is intentionally not referenced by the current Tauri root.  It
//! is a reusable, transaction-bound seam for a future Finance v2 integration;
//! Archive V9 and startup remain untouched while the canonical `.bean` path is
//! still active (ADR 0014, ADR 0018).

pub mod error;
pub mod schema;
pub mod store;
pub mod types;

pub use error::{FinanceStorageError, Result};
pub use store::FinanceStore;
pub use types::{PostingIdentity, TransactionIdentity};
