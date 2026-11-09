use std::collections::BTreeMap;
use serde::Serialize;

use crate::finance_v2_domain::{AccountKind, Amount, CommodityCode, Id, LedgerSnapshot, Quantity};

use super::{
    amount_abs, CalibrationDelta, LedgerProjection, ProjectionError,
    ProjectedAccount,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum BalanceBasis {
    /// Reconstructed from a later manual day-end calibration and recorded movements.
    TransactionDerived,
    /// Anchored to a manual day-end calibration point.
    CalibrationAnchored,
    /// There are recorded movements, but no manual calibration anchors this balance.
    UnknownNoCalibration,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DailyBalance {
    pub business_date: crate::finance_v2_domain::BusinessDate,
    pub account_id: Id,
    pub commodity: String,
    /// `None` means the absolute balance is unknown; never substitute zero.
    pub quantity: Option<Quantity>,
    pub basis: BalanceBasis,
    pub calibration_point_ids: Vec<Id>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct IncomeExpenseTotal {
    pub business_date: crate::finance_v2_domain::BusinessDate,
    pub account_id: Id,
    pub kind: AccountKind,
    pub quantity: Quantity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SettlementTotal {
    pub business_date: crate::finance_v2_domain::BusinessDate,
    pub account_id: Id,
    pub kind: AccountKind,
    pub quantity: Quantity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReportProjection {
    pub generation: u64,
    pub daily_balances: Vec<DailyBalance>,
    pub income_expense_totals: Vec<IncomeExpenseTotal>,
    /// Actual counterparty quantities only. No exchange rate is inferred.
    pub settlement_totals: Vec<SettlementTotal>,
    pub calibration_deltas: Vec<CalibrationDelta>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum ReportKind { Expenses, Income }

impl ReportKind {
    fn as_account_kind(self) -> AccountKind {
        match self { Self::Expenses => AccountKind::Expenses, Self::Income => AccountKind::Income }
    }
}

type CategoryKey = (crate::finance_v2_domain::BusinessDate, Id, ReportKind, CommodityCode);

pub(super) fn project(
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
    calibration: super::CalibrationReport,
) -> Result<ReportProjection, ProjectionError> {
    let account_kinds = snapshot.accounts.iter().map(|account| (account.id.clone(), account.kind))
        .collect::<BTreeMap<_, _>>();
    let mut categories = BTreeMap::<CategoryKey, Amount>::new();
    let mut settlements = BTreeMap::<CategoryKey, Amount>::new();

    for transaction in &ledger.transactions {
        for posting in &transaction.postings {
            let ProjectedAccount::Formal(account_id) = &posting.account else { continue };
            let Some(kind) = account_kinds.get(account_id).copied().and_then(|kind| match kind {
                AccountKind::Expenses => Some(ReportKind::Expenses),
                AccountKind::Income => Some(ReportKind::Income),
                _ => None,
            }) else { continue };
            let magnitude = amount_abs(posting.quantity.amount)?;
            let key = (transaction.business_date, account_id.clone(), kind, posting.quantity.commodity.clone());
            add_amount(&mut categories, key.clone(), magnitude)?;

            let settlement = if let Some(total_price) = &posting.total_price {
                if !total_price.amount.is_positive() {
                    return Err(ProjectionError::InvalidProjectedTransaction);
                }
                total_price.clone()
            } else {
                Quantity::new(magnitude, posting.quantity.commodity.clone())
            };
            let settlement_key = (transaction.business_date, account_id.clone(), kind, settlement.commodity.clone());
            add_amount(&mut settlements, settlement_key, settlement.amount)?;
        }
    }

    let income_expense_totals = categories.into_iter().map(|((business_date, account_id, kind, commodity), amount)| {
        Ok(IncomeExpenseTotal { business_date, account_id, kind: kind.as_account_kind(), quantity: Quantity::new(amount, commodity) })
    }).collect::<Result<Vec<_>, ProjectionError>>()?;
    let settlement_totals = settlements.into_iter().map(|((business_date, account_id, kind, commodity), amount)| {
        Ok(SettlementTotal { business_date, account_id, kind: kind.as_account_kind(), quantity: Quantity::new(amount, commodity) })
    }).collect::<Result<Vec<_>, ProjectionError>>()?;

    Ok(ReportProjection {
        generation: ledger.generation,
        daily_balances: calibration.balances,
        income_expense_totals,
        settlement_totals,
        calibration_deltas: calibration.deltas,
    })
}

fn add_amount(
    values: &mut BTreeMap<CategoryKey, Amount>,
    key: CategoryKey,
    amount: Amount,
) -> Result<(), ProjectionError> {
    let sum = values.get(&key).copied().unwrap_or(Amount::new(0, amount.scale())?)
        .checked_add(amount)?;
    values.insert(key, sum);
    Ok(())
}

