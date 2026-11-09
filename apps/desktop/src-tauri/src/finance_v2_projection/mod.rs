//! Pure Finance v2 ledger and report projections.
//!
//! This module consumes immutable domain snapshots and only returns derived
//! values. The refund timing account is an internal projection role, not an
//! Account or L0 fact; see the contract in the Finance v2 engineering plan §5.

mod calibration;
mod l1;
mod reports;

use std::cmp::Ordering;
use serde::{ser::SerializeStruct, Serialize, Serializer};

use crate::finance_v2_domain::{
    Account, AccountKind, Amount, AmountError, Id, L0Fact,
    LedgerSnapshot, Quantity, Treatment,
};

pub use calibration::{CalibrationDelta, CalibrationReport};
pub use l1::{ProjectionLeg, ProjectedAccount, ProjectedPosting, ProjectedTransaction};
pub use reports::{
    BalanceBasis, DailyBalance, IncomeExpenseTotal, ReportProjection, SettlementTotal,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProjectionError {
    InvalidSnapshotGeneration,
    InvalidFact { fact_id: Id },
    DuplicateFact { fact_id: Id },
    DuplicateAccount { account_id: Id },
    DuplicateVia { via_id: Id },
    DuplicateTreatment { treatment_id: Id },
    InvalidOwnerGraph { treatment_id: Option<Id>, reason: &'static str },
    MissingAccount { account_id: Id },
    InactiveAccount { account_id: Id },
    MissingVia { via_id: Id },
    InactiveVia { via_id: Id },
    MissingFact { fact_id: Id },
    StaleRevision { fact_id: Id },
    UnsupportedAccountCombination { fact_id: Id },
    UnsupportedCrossCurrencyRefund { refund_id: Id },
    InvalidRefund { refund_id: Id, reason: &'static str },
    RefundCapExceeded { payment_id: Id },
    InvalidCalibration { calibration_id: Id },
    DuplicateCalibrationDate { account_id: Id, commodity: String },
    DuplicateCalibration { calibration_id: Id },
    CalibrationAccountNotFunds { account_id: Id },
    InvalidProjectedQuantity,
    InvalidProjectedTransaction,
    SnapshotProjectionMismatch,
    Arithmetic(AmountError),
    CalibrationDateOverflow { calibration_id: Id },
}

impl Serialize for ProjectionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        let kind = match self {
            Self::InvalidSnapshotGeneration => "InvalidSnapshotGeneration",
            Self::InvalidFact { .. } => "InvalidFact",
            Self::DuplicateFact { .. } => "DuplicateFact",
            Self::DuplicateAccount { .. } => "DuplicateAccount",
            Self::DuplicateVia { .. } => "DuplicateVia",
            Self::DuplicateTreatment { .. } => "DuplicateTreatment",
            Self::InvalidOwnerGraph { .. } => "InvalidOwnerGraph",
            Self::MissingAccount { .. } => "MissingAccount",
            Self::InactiveAccount { .. } => "InactiveAccount",
            Self::MissingVia { .. } => "MissingVia",
            Self::InactiveVia { .. } => "InactiveVia",
            Self::MissingFact { .. } => "MissingFact",
            Self::StaleRevision { .. } => "StaleRevision",
            Self::UnsupportedAccountCombination { .. } => "UnsupportedAccountCombination",
            Self::UnsupportedCrossCurrencyRefund { .. } => "UnsupportedCrossCurrencyRefund",
            Self::InvalidRefund { .. } => "InvalidRefund",
            Self::RefundCapExceeded { .. } => "RefundCapExceeded",
            Self::InvalidCalibration { .. } => "InvalidCalibration",
            Self::DuplicateCalibrationDate { .. } => "DuplicateCalibrationDate",
            Self::DuplicateCalibration { .. } => "DuplicateCalibration",
            Self::CalibrationAccountNotFunds { .. } => "CalibrationAccountNotFunds",
            Self::InvalidProjectedQuantity => "InvalidProjectedQuantity",
            Self::InvalidProjectedTransaction => "InvalidProjectedTransaction",
            Self::SnapshotProjectionMismatch => "SnapshotProjectionMismatch",
            Self::Arithmetic(_) => "Arithmetic",
            Self::CalibrationDateOverflow { .. } => "CalibrationDateOverflow",
        };
        let mut state = serializer.serialize_struct("ProjectionError", 2)?;
        state.serialize_field("kind", kind)?;
        state.serialize_field("details", &format!("{self:?}"))?;
        state.end()
    }
}

impl From<AmountError> for ProjectionError {
    fn from(value: AmountError) -> Self {
        Self::Arithmetic(value)
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct FactTrace {
    pub id: Id,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct OwnerTrace {
    pub id: Id,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LedgerProjection {
    pub generation: u64,
    pub transactions: Vec<ProjectedTransaction>,
}

/// Project the current immutable L0 snapshot and its complete current owners.
///
/// Invalid references and owner graphs fail closed. Input vector order does
/// not affect transaction ordering or trace ordering.
pub fn project_ledger(snapshot: &LedgerSnapshot) -> Result<LedgerProjection, ProjectionError> {
    if snapshot.generation == 0 {
        return Err(ProjectionError::InvalidSnapshotGeneration);
    }
    validate_snapshot(snapshot)?;
    let transactions = l1::project(snapshot)?;
    Ok(LedgerProjection { generation: snapshot.generation, transactions })
}

/// Project original-currency reports and independently derived calibration
/// deltas from the same generation as the ledger.
pub fn project_reports(
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
) -> Result<ReportProjection, ProjectionError> {
    if snapshot.generation != ledger.generation {
        return Err(ProjectionError::InvalidSnapshotGeneration);
    }
    if project_ledger(snapshot)? != *ledger {
        return Err(ProjectionError::SnapshotProjectionMismatch);
    }
    validate_calibrations(snapshot)?;
    let balances = calibration::project(snapshot, ledger)?;
    reports::project(snapshot, ledger, balances)
}

pub(crate) fn validate_snapshot(snapshot: &LedgerSnapshot) -> Result<(), ProjectionError> {
    let mut accounts = std::collections::BTreeMap::<Id, &Account>::new();
    for account in &snapshot.accounts {
        if account.revision == 0 || accounts.insert(account.id.clone(), account).is_some() {
            return Err(ProjectionError::DuplicateAccount { account_id: account.id.clone() });
        }
    }

    let mut facts = std::collections::BTreeMap::<Id, &L0Fact>::new();
    for fact in &snapshot.active_leaf_facts {
        if fact.validate().is_err() || fact.status != crate::finance_v2_domain::FactStatus::Active {
            return Err(ProjectionError::InvalidFact { fact_id: fact.id.clone() });
        }
        if facts.insert(fact.id.clone(), fact).is_some() {
            return Err(ProjectionError::DuplicateFact { fact_id: fact.id.clone() });
        }
        for account_id in [&fact.positive_account_id, &fact.negative_account_id] {
            let account = accounts
                .get(account_id)
                .ok_or_else(|| ProjectionError::MissingAccount { account_id: account_id.clone() })?;
            if !account.active {
                return Err(ProjectionError::InactiveAccount { account_id: account_id.clone() });
            }
        }
        if let Some(via_id) = &fact.via_id {
            let via = snapshot.vias.iter().find(|via| &via.id == via_id)
                .ok_or_else(|| ProjectionError::MissingVia { via_id: via_id.clone() })?;
            if !via.active {
                return Err(ProjectionError::InactiveVia { via_id: via_id.clone() });
            }
        }
    }

    let mut via_ids = std::collections::BTreeSet::new();
    for via in &snapshot.vias {
        if via.revision == 0 || !via_ids.insert(via.id.clone()) {
            return Err(ProjectionError::DuplicateVia { via_id: via.id.clone() });
        }
    }

    let mut treatment_ids = std::collections::BTreeSet::new();
    let mut owned_facts = std::collections::BTreeMap::<Id, Id>::new();
    for treatment in &snapshot.current_treatments {
        validate_treatment(treatment, &facts, &accounts, &mut owned_facts)?;
        if !treatment_ids.insert(treatment.id.clone()) {
            return Err(ProjectionError::DuplicateTreatment { treatment_id: treatment.id.clone() });
        }
    }
    Ok(())
}

pub(crate) fn validate_treatment(
    treatment: &Treatment,
    facts: &std::collections::BTreeMap<Id, &L0Fact>,
    accounts: &std::collections::BTreeMap<Id, &Account>,
    owned_facts: &mut std::collections::BTreeMap<Id, Id>,
) -> Result<(), ProjectionError> {
    let fail = |reason| ProjectionError::InvalidOwnerGraph {
        treatment_id: Some(treatment.id.clone()),
        reason,
    };
    if treatment.revision == 0 || treatment.members.is_empty() {
        return Err(fail("empty owner or zero revision"));
    }
    let member_ids = treatment.members.iter().map(|member| member.l0_id.clone()).collect::<std::collections::BTreeSet<_>>();
    if member_ids.len() != treatment.members.len() || !member_ids.contains(&treatment.owner_l0_id) {
        return Err(fail("owner anchor missing or duplicate member"));
    }
    for member in &treatment.members {
        let fact = facts.get(&member.l0_id)
            .ok_or_else(|| ProjectionError::MissingFact { fact_id: member.l0_id.clone() })?;
        if fact.revision != member.revision {
            return Err(ProjectionError::StaleRevision { fact_id: member.l0_id.clone() });
        }
        if owned_facts.insert(member.l0_id.clone(), treatment.id.clone()).is_some() {
            return Err(fail("fact has more than one current owner"));
        }
    }

    let mut grouped = std::collections::BTreeSet::<Id>::new();
    for group in &treatment.merge_groups {
        if group.members.len() < 2 {
            return Err(fail("merge group has fewer than two members"));
        }
        let mut group_ids = std::collections::BTreeSet::new();
        let mut day = None;
        for member in &group.members {
            if !member_ids.contains(&member.l0_id) || !group_ids.insert(member.l0_id.clone()) {
                return Err(fail("merge group contains an unknown or duplicate member"));
            }
            let fact = facts.get(&member.l0_id).ok_or_else(|| ProjectionError::MissingFact { fact_id: member.l0_id.clone() })?;
            if fact.revision != member.revision {
                return Err(ProjectionError::StaleRevision { fact_id: member.l0_id.clone() });
            }
            if day.replace(fact.effective_date).is_some_and(|previous| previous != fact.effective_date) {
                return Err(fail("ordinary merge members must share a business date"));
            }
            if !grouped.insert(member.l0_id.clone()) {
                return Err(fail("fact belongs to more than one merge group"));
            }
        }
    }

    let mut refunded = std::collections::BTreeSet::<Id>::new();
    let mut totals = std::collections::BTreeMap::<Id, Quantity>::new();
    for edge in &treatment.refund_edges {
        if !member_ids.contains(&edge.refund.l0_id) || !member_ids.contains(&edge.payment.l0_id)
            || edge.refund.l0_id == edge.payment.l0_id
        {
            return Err(fail("refund edge must connect two distinct owner members"));
        }
        let refund = facts.get(&edge.refund.l0_id).ok_or_else(|| ProjectionError::MissingFact { fact_id: edge.refund.l0_id.clone() })?;
        let payment = facts.get(&edge.payment.l0_id).ok_or_else(|| ProjectionError::MissingFact { fact_id: edge.payment.l0_id.clone() })?;
        if refund.revision != edge.refund.revision { return Err(ProjectionError::StaleRevision { fact_id: edge.refund.l0_id.clone() }); }
        if payment.revision != edge.payment.revision { return Err(ProjectionError::StaleRevision { fact_id: edge.payment.l0_id.clone() }); }
        if !refunded.insert(edge.refund.l0_id.clone()) {
            return Err(fail("refund fact has more than one payment edge"));
        }
        validate_refund(edge, refund, payment, accounts)?;
        let total = if let Some(current) = totals.get(&edge.payment.l0_id) {
            let next = current.amount.checked_add(edge.amount.amount)?;
            Quantity::new(next, edge.amount.commodity.clone())
        } else {
            edge.amount.clone()
        };
        let payment_expense = expense_quantity(payment, accounts)?;
        if total.commodity != payment_expense.commodity
            || total.amount.exact_cmp(payment_expense.amount)? == Ordering::Greater
        {
            return Err(ProjectionError::RefundCapExceeded { payment_id: edge.payment.l0_id.clone() });
        }
        totals.insert(edge.payment.l0_id.clone(), total);
    }
    Ok(())
}

fn validate_refund(
    edge: &crate::finance_v2_domain::RefundEdge,
    refund: &L0Fact,
    payment: &L0Fact,
    accounts: &std::collections::BTreeMap<Id, &Account>,
) -> Result<(), ProjectionError> {
    let refund_id = refund.id.clone();
    let payment_expense_id = expense_account_id(payment, accounts)
        .ok_or_else(|| ProjectionError::InvalidRefund { refund_id: refund_id.clone(), reason: "payment is not a canonical expense" })?;
    let refund_expense_id = expense_account_id(refund, accounts)
        .ok_or_else(|| ProjectionError::InvalidRefund { refund_id: refund_id.clone(), reason: "refund is not a canonical expense reversal" })?;
    if payment.positive_account_id != payment_expense_id
        || refund.negative_account_id != refund_expense_id
        || refund_expense_id != payment_expense_id
        || !is_funds(accounts.get(&payment.negative_account_id).copied())
        || !is_funds(accounts.get(&refund.positive_account_id).copied())
    {
        return Err(ProjectionError::InvalidRefund { refund_id, reason: "refund endpoints do not match payment Expense/funds direction" });
    }
    let commodities = [
        &payment.positive.commodity,
        &payment.negative.commodity,
        &refund.positive.commodity,
        &refund.negative.commodity,
        &edge.amount.commodity,
    ];
    if commodities.iter().any(|commodity| *commodity != commodities[0]) {
        return Err(ProjectionError::UnsupportedCrossCurrencyRefund { refund_id });
    }
    if !edge.amount.amount.is_positive()
        || edge.amount.amount.exact_cmp(refund.negative.amount)? != Ordering::Equal
    {
        return Err(ProjectionError::InvalidRefund { refund_id, reason: "edge amount must equal the actual refund Expense amount" });
    }
    if refund.effective_date < payment.effective_date {
        return Err(ProjectionError::InvalidRefund { refund_id: refund.id.clone(), reason: "refund date precedes payment date" });
    }
    Ok(())
}

pub(crate) fn expense_quantity<'a>(
    fact: &'a L0Fact,
    accounts: &std::collections::BTreeMap<Id, &Account>,
) -> Result<&'a Quantity, ProjectionError> {
    if accounts.get(&fact.positive_account_id).is_some_and(|account| account.kind == AccountKind::Expenses) {
        Ok(&fact.positive)
    } else if accounts.get(&fact.negative_account_id).is_some_and(|account| account.kind == AccountKind::Expenses) {
        Ok(&fact.negative)
    } else {
        Err(ProjectionError::UnsupportedAccountCombination { fact_id: fact.id.clone() })
    }
}

pub(crate) fn expense_account_id(
    fact: &L0Fact,
    accounts: &std::collections::BTreeMap<Id, &Account>,
) -> Option<Id> {
    if accounts.get(&fact.positive_account_id).is_some_and(|account| account.kind == AccountKind::Expenses) {
        Some(fact.positive_account_id.clone())
    } else if accounts.get(&fact.negative_account_id).is_some_and(|account| account.kind == AccountKind::Expenses) {
        Some(fact.negative_account_id.clone())
    } else { None }
}

pub(crate) fn is_funds(account: Option<&Account>) -> bool {
    account.is_some_and(|account| matches!(account.kind, AccountKind::Assets | AccountKind::Liabilities))
}

pub(crate) fn signed_quantity(quantity: &Quantity, negative: bool) -> Result<Quantity, ProjectionError> {
    let amount = if negative { quantity.amount.checked_neg()? } else { quantity.amount };
    Ok(Quantity::new(amount, quantity.commodity.clone()))
}

pub(crate) fn validate_calibrations(snapshot: &LedgerSnapshot) -> Result<(), ProjectionError> {
    let mut dates = std::collections::BTreeSet::new();
    let mut calibration_ids = std::collections::BTreeSet::new();
    let accounts = snapshot.accounts.iter().map(|a| (a.id.clone(), a)).collect::<std::collections::BTreeMap<_, _>>();
    for point in snapshot.calibrations.iter().filter(|point| point.status == crate::finance_v2_domain::types::CalibrationStatus::Active) {
        if point.revision == 0 || point.quantity.commodity.as_str().trim().is_empty() {
            return Err(ProjectionError::InvalidCalibration { calibration_id: point.id.clone() });
        }
        if !calibration_ids.insert(point.id.clone()) {
            return Err(ProjectionError::DuplicateCalibration { calibration_id: point.id.clone() });
        }
        let account = accounts.get(&point.account_id).ok_or_else(|| ProjectionError::MissingAccount { account_id: point.account_id.clone() })?;
        if !account.active { return Err(ProjectionError::InactiveAccount { account_id: point.account_id.clone() }); }
        if !matches!(account.kind, AccountKind::Assets | AccountKind::Liabilities) {
            return Err(ProjectionError::CalibrationAccountNotFunds { account_id: point.account_id.clone() });
        }
        let key = (point.account_id.clone(), point.quantity.commodity.clone(), point.business_date);
        if !dates.insert(key) {
            return Err(ProjectionError::DuplicateCalibrationDate { account_id: point.account_id.clone(), commodity: point.quantity.commodity.as_str().to_owned() });
        }
    }
    Ok(())
}

pub(crate) fn amount_abs(value: Amount) -> Result<Amount, ProjectionError> {
    if value.is_negative() { Ok(value.checked_neg()?) } else { Ok(value) }
}

