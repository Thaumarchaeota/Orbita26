use std::collections::{BTreeMap, BTreeSet};
use serde::Serialize;

use chrono::{Days, NaiveDate};

use crate::finance_v2_domain::{
    AccountKind, Amount, BusinessDate, CalibrationPoint, CommodityCode, Id, LedgerSnapshot, Quantity,
};

use super::{
    BalanceBasis, DailyBalance, LedgerProjection, ProjectionError, ProjectedAccount,
    ProjectedTransaction,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CalibrationDelta {
    pub account_id: Id,
    pub commodity: String,
    /// The delta takes effect at the end of this business date.
    pub effective_date: BusinessDate,
    /// Beancount balance assertions take effect at the start of their date;
    /// therefore this is the next date after the user's day-end point.
    pub bean_balance_date: BusinessDate,
    pub amount: Quantity,
    pub expected_before: Quantity,
    pub observed: Quantity,
    pub previous_point_id: Id,
    pub point_id: Id,
    pub point_revision: u64,
    pub generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CalibrationReport {
    pub balances: Vec<DailyBalance>,
    pub deltas: Vec<CalibrationDelta>,
}

type BalanceKey = (Id, CommodityCode);

pub(super) fn project(
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
) -> Result<CalibrationReport, ProjectionError> {
    let account_kinds = snapshot.accounts.iter()
        .map(|account| (account.id.clone(), account.kind))
        .collect::<BTreeMap<_, _>>();
    let mut movements = BTreeMap::<BalanceKey, BTreeMap<BusinessDate, Amount>>::new();
    for transaction in &ledger.transactions {
        add_transaction_movements(transaction, &account_kinds, &mut movements)?;
    }

    let mut points = BTreeMap::<BalanceKey, Vec<&CalibrationPoint>>::new();
    for point in snapshot.calibrations.iter()
        .filter(|point| point.status == crate::finance_v2_domain::types::CalibrationStatus::Active)
    {
        points.entry((point.account_id.clone(), point.quantity.commodity.clone()))
            .or_default().push(point);
    }
    for point_list in points.values_mut() {
        point_list.sort_by(|a, b| a.business_date.cmp(&b.business_date).then_with(|| a.id.cmp(&b.id)));
    }

    let mut deltas = Vec::new();
    let mut balances = Vec::new();
    let mut keys = points.keys().cloned().collect::<BTreeSet<_>>();
    keys.extend(movements.keys().cloned());
    for key in keys {
        let account_moves = movements.get(&key).cloned().unwrap_or_default();
        let Some(point_list) = points.get(&key) else {
            for date in account_moves.keys().copied() {
                balances.push(DailyBalance {
                    business_date: date,
                    account_id: key.0.clone(),
                    commodity: key.1.as_str().to_owned(),
                    quantity: None,
                    basis: BalanceBasis::UnknownNoCalibration,
                    calibration_point_ids: Vec::new(),
                });
            }
            continue;
        };
        let Some(first) = point_list.first() else { continue };
        let mut prior_point = *first;
        let mut predicted = first.quantity.amount;
        for point in point_list.iter().skip(1) {
            let through_point = sum_movements(&account_moves, Some(prior_point.business_date), Some(point.business_date))?;
            predicted = predicted.checked_add(through_point)?;
            let delta = point.quantity.amount.checked_sub(predicted)?;
            if !delta.is_zero() {
                deltas.push(CalibrationDelta {
                    account_id: key.0.clone(),
                    commodity: key.1.as_str().to_owned(),
                    effective_date: point.business_date,
                    bean_balance_date: next_business_date(point)?,
                    amount: Quantity::new(delta, key.1.clone()),
                    expected_before: Quantity::new(predicted, key.1.clone()),
                    observed: point.quantity.clone(),
                    previous_point_id: prior_point.id.clone(),
                    point_id: point.id.clone(),
                    point_revision: point.revision,
                    generation: ledger.generation,
                });
            }
            predicted = point.quantity.amount;
            prior_point = point;
        }

        let mut dates = account_moves.keys().copied().collect::<BTreeSet<_>>();
        dates.extend(point_list.iter().map(|point| point.business_date));
        for date in dates {
            let balance = if date < first.business_date {
                let after_date = sum_movements(&account_moves, Some(date), Some(first.business_date))?;
                first.quantity.amount.checked_sub(after_date)?
            } else {
                let base = point_list.iter().rev().find(|point| point.business_date <= date)
                    .copied().unwrap_or(first);
                let later_movements = sum_movements(&account_moves, Some(base.business_date), Some(date))?;
                base.quantity.amount.checked_add(later_movements)?
            };
            let anchor_ids = if date < first.business_date {
                vec![first.id.clone()]
            } else {
                point_list.iter().filter(|point| point.business_date <= date)
                    .map(|point| point.id.clone()).collect::<Vec<_>>()
            };
            balances.push(DailyBalance {
                business_date: date,
                account_id: key.0.clone(),
                commodity: key.1.as_str().to_owned(),
                quantity: Some(Quantity::new(balance, key.1.clone())),
                basis: if date < first.business_date { BalanceBasis::TransactionDerived } else { BalanceBasis::CalibrationAnchored },
                calibration_point_ids: anchor_ids,
            });
        }
    }
    balances.sort_by(|a, b| a.business_date.cmp(&b.business_date)
        .then_with(|| a.account_id.cmp(&b.account_id)).then_with(|| a.commodity.cmp(&b.commodity)));
    deltas.sort_by(|a, b| a.effective_date.cmp(&b.effective_date)
        .then_with(|| a.account_id.cmp(&b.account_id)).then_with(|| a.commodity.cmp(&b.commodity))
        .then_with(|| a.point_id.cmp(&b.point_id)));
    Ok(CalibrationReport { balances, deltas })
}

fn add_transaction_movements(
    transaction: &ProjectedTransaction,
    account_kinds: &BTreeMap<Id, AccountKind>,
    movements: &mut BTreeMap<BalanceKey, BTreeMap<BusinessDate, Amount>>,
) -> Result<(), ProjectionError> {
    for posting in &transaction.postings {
        let ProjectedAccount::Formal(account_id) = &posting.account else { continue };
        let Some(kind) = account_kinds.get(account_id) else {
            return Err(ProjectionError::MissingAccount { account_id: account_id.clone() });
        };
        if !matches!(kind, AccountKind::Assets | AccountKind::Liabilities) { continue; }
        let date_movements = movements.entry((account_id.clone(), posting.quantity.commodity.clone()))
            .or_default();
        let current = date_movements.get(&transaction.business_date).copied()
            .unwrap_or(Amount::new(0, posting.quantity.amount.scale())?);
        date_movements.insert(transaction.business_date, current.checked_add(posting.quantity.amount)?);
    }
    Ok(())
}

/// Sum movement on (after, through], which is the interval between day-end
/// balance anchors. The first anchor's date itself is excluded.
fn sum_movements(
    movements: &BTreeMap<BusinessDate, Amount>,
    after: Option<BusinessDate>,
    through: Option<BusinessDate>,
) -> Result<Amount, ProjectionError> {
    let mut sum = Amount::new(0, 0)?;
    for (date, amount) in movements {
        if after.is_some_and(|after| *date <= after) || through.is_some_and(|through| *date > through) {
            continue;
        }
        sum = sum.checked_add(*amount)?;
    }
    Ok(sum)
}

fn next_business_date(point: &CalibrationPoint) -> Result<BusinessDate, ProjectionError> {
    let next: NaiveDate = point.business_date.as_naive().checked_add_days(Days::new(1))
        .ok_or_else(|| ProjectionError::CalibrationDateOverflow { calibration_id: point.id.clone() })?;
    BusinessDate::parse(&next.format("%Y-%m-%d").to_string())
        .map_err(|_| ProjectionError::CalibrationDateOverflow { calibration_id: point.id.clone() })
}

