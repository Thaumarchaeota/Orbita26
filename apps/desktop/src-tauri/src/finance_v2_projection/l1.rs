use std::collections::{BTreeMap, BTreeSet};
use serde::Serialize;

use crate::finance_v2_domain::{
    Account, AccountKind, Id, L0Fact, LedgerSnapshot, Quantity, RefundEdge, Treatment,
};

use super::{
    expense_account_id, is_funds, signed_quantity, FactTrace, OwnerTrace, ProjectionError,
};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum ProjectedAccount {
    Formal(Id),
    RefundTimingEquity { commodity: String },
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum ProjectionLeg {
    Ordinary,
    OwnerMember,
    Merge,
    RefundPayment,
    RefundReceipt,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProjectedPosting {
    pub account: ProjectedAccount,
    /// Signed quantity in the account's own commodity.
    pub quantity: Quantity,
    /// Beancount `@@` total price. Kept positive; the posting sign supplies
    /// the valuation direction (e.g. `Expenses 100 USD @@ 730 CNY`).
    pub total_price: Option<Quantity>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProjectedTransaction {
    pub business_date: crate::finance_v2_domain::BusinessDate,
    pub title: String,
    pub notes: String,
    pub owner: Option<OwnerTrace>,
    pub source_facts: Vec<FactTrace>,
    pub leg: ProjectionLeg,
    pub postings: Vec<ProjectedPosting>,
}

struct FactRow {
    fact_id: Id,
    transaction: ProjectedTransaction,
}

pub(super) fn project(snapshot: &LedgerSnapshot) -> Result<Vec<ProjectedTransaction>, ProjectionError> {
    let accounts = snapshot.accounts.iter().map(|account| (account.id.clone(), account)).collect::<BTreeMap<_, _>>();
    let facts = snapshot.active_leaf_facts.iter().map(|fact| (fact.id.clone(), fact)).collect::<BTreeMap<_, _>>();
    let mut owner_by_fact = BTreeMap::<Id, &Treatment>::new();
    let mut refund_for_payment = BTreeMap::<Id, Vec<&RefundEdge>>::new();
    let mut refund_edge_by_refund = BTreeMap::<Id, &RefundEdge>::new();
    for treatment in &snapshot.current_treatments {
        for member in &treatment.members { owner_by_fact.insert(member.l0_id.clone(), treatment); }
        for edge in &treatment.refund_edges {
            refund_for_payment.entry(edge.payment.l0_id.clone()).or_default().push(edge);
            refund_edge_by_refund.insert(edge.refund.l0_id.clone(), edge);
        }
    }
    for edges in refund_for_payment.values_mut() {
        edges.sort_by(|a, b| a.refund.l0_id.cmp(&b.refund.l0_id));
    }

    let mut rows = Vec::with_capacity(facts.len());
    for fact in &snapshot.active_leaf_facts {
        let treatment = owner_by_fact.get(&fact.id).copied();
        let owner = treatment.map(|t| OwnerTrace { id: t.id.clone(), revision: t.revision });
        let mut row = if let Some(edge) = refund_edge_by_refund.get(&fact.id) {
            refund_receipt_row(fact, facts[&edge.payment.l0_id], edge, &accounts, owner.clone())?
        } else if let Some(edges) = refund_for_payment.get(&fact.id) {
            refund_payment_row(fact, edges, &facts, &accounts, owner.clone())?
        } else {
            ordinary_row(fact, &accounts, owner.clone())?
        };
        row.transaction.source_facts.sort_by(|a, b| a.id.cmp(&b.id));
        row.transaction.source_facts.dedup_by(|a, b| a.id == b.id && a.revision == b.revision);
        rows.push(row);
    }

    let mut emitted = BTreeSet::<Id>::new();
    let mut output = Vec::new();
    for treatment in &snapshot.current_treatments {
        let rows_by_id = rows.iter().map(|row| (row.fact_id.clone(), row)).collect::<BTreeMap<_, _>>();
        for group in &treatment.merge_groups {
            let mut group_rows = group.members.iter().map(|member| {
                rows_by_id.get(&member.l0_id).copied().ok_or_else(|| ProjectionError::MissingFact { fact_id: member.l0_id.clone() })
            }).collect::<Result<Vec<_>, _>>()?;
            group_rows.sort_by(|a, b| a.fact_id.cmp(&b.fact_id));
            let first = group_rows.first().ok_or(ProjectionError::InvalidOwnerGraph {
                treatment_id: Some(treatment.id.clone()), reason: "empty merge group",
            })?;
            let mut postings = Vec::new();
            let mut sources = Vec::new();
            for row in &group_rows {
                if row.transaction.business_date != first.transaction.business_date {
                    return Err(ProjectionError::InvalidOwnerGraph {
                        treatment_id: Some(treatment.id.clone()), reason: "merge spans business dates",
                    });
                }
                postings.extend(row.transaction.postings.clone());
                sources.extend(row.transaction.source_facts.clone());
                emitted.insert(row.fact_id.clone());
            }
            postings.sort_by(|a, b| (&a.account, &a.quantity.commodity, a.quantity.amount.to_decimal_string())
                .cmp(&(&b.account, &b.quantity.commodity, b.quantity.amount.to_decimal_string())));
            sources.sort_by(|a, b| a.id.cmp(&b.id));
            sources.dedup_by(|a, b| a.id == b.id && a.revision == b.revision);
            let title = if treatment.title.trim().is_empty() {
                format!("合并交易（{}笔）", group.members.len())
            } else { treatment.title.clone() };
            output.push(ProjectedTransaction {
                business_date: first.transaction.business_date,
                title,
                notes: treatment.notes.clone(),
                owner: Some(OwnerTrace { id: treatment.id.clone(), revision: treatment.revision }),
                source_facts: sources,
                leg: ProjectionLeg::Merge,
                postings,
            });
        }
    }
    for row in rows {
        if !emitted.contains(&row.fact_id) { output.push(row.transaction); }
    }
    output.sort_by(|a, b| {
        a.business_date.cmp(&b.business_date)
            .then_with(|| a.owner.as_ref().map(|owner| owner.id.clone()).cmp(&b.owner.as_ref().map(|owner| owner.id.clone())))
            .then_with(|| a.source_facts.cmp(&b.source_facts))
            .then_with(|| a.leg.cmp(&b.leg))
    });
    Ok(output)
}

fn ordinary_row(
    fact: &L0Fact,
    accounts: &BTreeMap<Id, &Account>,
    owner: Option<OwnerTrace>,
) -> Result<FactRow, ProjectionError> {
    let positive = accounts.get(&fact.positive_account_id).copied()
        .ok_or_else(|| ProjectionError::MissingAccount { account_id: fact.positive_account_id.clone() })?;
    let negative = accounts.get(&fact.negative_account_id).copied()
        .ok_or_else(|| ProjectionError::MissingAccount { account_id: fact.negative_account_id.clone() })?;
    let mut postings = Vec::new();
    if fact.positive.commodity == fact.negative.commodity {
        if positive.kind == AccountKind::Expenses && fact.positive.amount.is_negative()
            || positive.kind == AccountKind::Income && fact.positive.amount.is_positive()
            || negative.kind == AccountKind::Expenses && fact.negative.amount.is_positive()
            || negative.kind == AccountKind::Income && fact.negative.amount.is_negative()
        {
            return Err(ProjectionError::UnsupportedAccountCombination { fact_id: fact.id.clone() });
        }
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.positive_account_id.clone()),
            quantity: signed_quantity(&fact.positive, false)?,
            total_price: None,
        });
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.negative_account_id.clone()),
            quantity: signed_quantity(&fact.negative, true)?,
            total_price: None,
        });
    } else if positive.kind == AccountKind::Expenses && is_funds(Some(negative)) {
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.positive_account_id.clone()),
            quantity: signed_quantity(&fact.positive, false)?,
            total_price: Some(fact.negative.clone()),
        });
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.negative_account_id.clone()),
            quantity: signed_quantity(&fact.negative, true)?,
            total_price: None,
        });
    } else if negative.kind == AccountKind::Income && is_funds(Some(positive)) {
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.positive_account_id.clone()),
            quantity: signed_quantity(&fact.positive, false)?,
            total_price: None,
        });
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.negative_account_id.clone()),
            quantity: signed_quantity(&fact.negative, true)?,
            total_price: Some(fact.positive.clone()),
        });
    } else if is_funds(Some(positive)) && is_funds(Some(negative)) {
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.positive_account_id.clone()),
            quantity: signed_quantity(&fact.positive, false)?,
            total_price: None,
        });
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(fact.negative_account_id.clone()),
            quantity: signed_quantity(&fact.negative, true)?,
            total_price: Some(fact.positive.clone()),
        });
    } else {
        return Err(ProjectionError::UnsupportedAccountCombination { fact_id: fact.id.clone() });
    }
    postings.sort_by(|a, b| a.account.cmp(&b.account));
    let leg = if owner.is_some() { ProjectionLeg::OwnerMember } else { ProjectionLeg::Ordinary };
    Ok(FactRow {
        fact_id: fact.id.clone(),
        transaction: ProjectedTransaction {
            business_date: fact.effective_date,
            title: fact.title.clone(), notes: fact.notes.clone(), owner,
            source_facts: vec![FactTrace { id: fact.id.clone(), revision: fact.revision }],
            leg,
            postings,
        },
    })
}

fn refund_payment_row(
    payment: &L0Fact,
    edges: &[&RefundEdge],
    facts: &BTreeMap<Id, &L0Fact>,
    accounts: &BTreeMap<Id, &Account>,
    owner: Option<OwnerTrace>,
) -> Result<FactRow, ProjectionError> {
    let expense_id = expense_account_id(payment, accounts)
        .ok_or_else(|| ProjectionError::InvalidRefund { refund_id: payment.id.clone(), reason: "payment Expense missing" })?;
    if payment.positive_account_id != expense_id || !is_funds(accounts.get(&payment.negative_account_id).copied()) {
        return Err(ProjectionError::InvalidRefund { refund_id: payment.id.clone(), reason: "payment must be positive Expense and negative funds" });
    }
    let mut refunded = Quantity::new(crate::finance_v2_domain::Amount::new(0, payment.positive.amount.scale())?, payment.positive.commodity.clone());
    let mut sources = vec![FactTrace { id: payment.id.clone(), revision: payment.revision }];
    for edge in edges {
        if facts.get(&edge.refund.l0_id).is_none() {
            return Err(ProjectionError::MissingFact { fact_id: edge.refund.l0_id.clone() });
        }
        refunded.amount = refunded.amount.checked_add(edge.amount.amount)?;
        sources.push(FactTrace { id: edge.refund.l0_id.clone(), revision: edge.refund.revision });
    }
    let remaining = payment.positive.amount.checked_sub(refunded.amount)?;
    let mut postings = Vec::new();
    if !remaining.is_zero() {
        postings.push(ProjectedPosting {
            account: ProjectedAccount::Formal(expense_id),
            quantity: Quantity::new(remaining, payment.positive.commodity.clone()),
            total_price: None,
        });
    }
    postings.push(ProjectedPosting {
        account: ProjectedAccount::Formal(payment.negative_account_id.clone()),
        quantity: signed_quantity(&payment.negative, true)?,
        total_price: None,
    });
    if !refunded.amount.is_zero() {
        postings.push(ProjectedPosting {
            account: ProjectedAccount::RefundTimingEquity { commodity: refunded.commodity.as_str().to_owned() },
            quantity: refunded.clone(), total_price: None,
        });
    }
    sources.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(FactRow {
        fact_id: payment.id.clone(),
        transaction: ProjectedTransaction {
            business_date: payment.effective_date, title: payment.title.clone(), notes: payment.notes.clone(),
            owner, source_facts: sources, leg: ProjectionLeg::RefundPayment, postings,
        },
    })
}

fn refund_receipt_row(
    refund: &L0Fact,
    payment: &L0Fact,
    edge: &RefundEdge,
    accounts: &BTreeMap<Id, &Account>,
    owner: Option<OwnerTrace>,
) -> Result<FactRow, ProjectionError> {
    if refund.effective_date < payment.effective_date {
        return Err(ProjectionError::InvalidRefund { refund_id: refund.id.clone(), reason: "refund date precedes payment date" });
    }
    if !is_funds(accounts.get(&refund.positive_account_id).copied())
        || accounts.get(&refund.negative_account_id).map_or(true, |account| account.kind != AccountKind::Expenses)
    {
        return Err(ProjectionError::InvalidRefund { refund_id: refund.id.clone(), reason: "refund must be positive funds and negative Expense" });
    }
    let mut postings = vec![ProjectedPosting {
        account: ProjectedAccount::Formal(refund.positive_account_id.clone()),
        quantity: signed_quantity(&refund.positive, false)?, total_price: None,
    }];
    postings.push(ProjectedPosting {
        account: ProjectedAccount::RefundTimingEquity { commodity: edge.amount.commodity.as_str().to_owned() },
        quantity: signed_quantity(&edge.amount, true)?, total_price: None,
    });
    postings.sort_by(|a, b| a.account.cmp(&b.account));
    let mut source_facts = vec![
        FactTrace { id: refund.id.clone(), revision: refund.revision },
        FactTrace { id: payment.id.clone(), revision: payment.revision },
    ];
    source_facts.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(FactRow {
        fact_id: refund.id.clone(),
        transaction: ProjectedTransaction {
            business_date: refund.effective_date, title: refund.title.clone(), notes: refund.notes.clone(),
            owner, source_facts, leg: ProjectionLeg::RefundReceipt, postings,
        },
    })
}

