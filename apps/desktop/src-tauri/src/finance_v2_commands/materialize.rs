//! Deterministic Finance v2 Beancount rendering and isolated publication.
//!
//! This module never writes the Finance database or changes generations,
//! receipts, or materialization jobs. The caller owns those responsibilities.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::MutexGuard,
    thread,
    time::{Duration, Instant},
};

use chrono::Days;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    finance_v2_domain::{AccountKind, Amount, BusinessDate, Id, LedgerSnapshot, Quantity},
    finance_v2_projection::{
        project_ledger, project_reports, BalanceBasis, LedgerProjection, ProjectedAccount,
        ProjectedTransaction, ReportProjection,
    },
    finance_v2_workspace::IsolatedWorkspaceRoot,
};

use super::session::guarded_root_path;

const MATERIALIZED_DIR: &str = "materialized";
const MAIN_FILE: &str = "main.bean";
const REPORT_FILE: &str = "reports.json";
const MANIFEST_FILE: &str = "manifest.json";
const ACTIVE_MANIFEST: &str = "active-manifest.json";
const MAX_RENDERED_FILE_BYTES: usize = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_VALIDATOR_STDOUT_BYTES: usize = 1024 * 1024;
const MAX_VALIDATOR_SECONDS: u64 = 30;
const MAX_DIAGNOSTIC_LINES: usize = 32;

#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
struct MaterializationManifest {
    format_version: u32,
    generation: u64,
    outputs: Vec<ManifestOutput>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Eq, PartialEq)]
struct ManifestOutput {
    path: String,
    byte_length: u64,
    sha256: String,
}

#[derive(Clone, Debug)]
pub(crate) struct StagedMaterialization {
    pub(crate) generation: u64,
    pub(crate) manifest_sha256: String,
    pub(crate) output_paths: Vec<String>,
    stage_relative_path: String,
    manifest_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MaterializationResult {
    pub(crate) generation: u64,
    pub(crate) manifest_sha256: String,
    pub(crate) active_manifest_path: String,
    pub(crate) output_paths: Vec<String>,
}

#[derive(Clone, Debug)]
struct RenderEvent {
    date: BusinessDate,
    rank: u8,
    key: String,
    text: String,
}

/// Render and validate a complete generation into a new, immutable stage.
pub(crate) fn prepare_materialization(
    root: &IsolatedWorkspaceRoot,
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
    report: &ReportProjection,
    generation: u64,
) -> Result<StagedMaterialization, String> {
    verify_projection_inputs(snapshot, ledger, report, generation)?;
    let account_paths = resolve_used_account_paths(snapshot, ledger, report)?;
    let bean_text = render_ledger(snapshot, ledger, report, generation, &account_paths)?;
    let mut report_bytes = Vec::new();
    serde_json::to_writer(
        CappedVecWriter::new(&mut report_bytes, MAX_RENDERED_FILE_BYTES),
        report,
    )
    .map_err(|_| "report_serialization_failed_or_too_large")?;

    ensure_root_directory(root, MATERIALIZED_DIR)?;
    let stage_name = format!("generation-{generation}.stage-{}", Uuid::new_v4());
    let stage_relative_path = format!("{MATERIALIZED_DIR}/{stage_name}");
    let stage_directory = create_root_directory(root, &stage_relative_path)?;
    let main_relative_path = format!("{stage_relative_path}/{MAIN_FILE}");
    let report_relative_path = format!("{stage_relative_path}/{REPORT_FILE}");
    let main_path = guarded_file_path(root, &main_relative_path)?;
    let report_path = guarded_file_path(root, &report_relative_path)?;

    write_new_file(&main_path, bean_text.as_bytes())?;
    write_new_file(&report_path, &report_bytes)?;
    validate_beancount(root, &stage_directory, &main_path)?;

    let manifest = MaterializationManifest {
        format_version: 1,
        generation,
        outputs: vec![
            ManifestOutput {
                path: MAIN_FILE.into(),
                byte_length: bean_text.len() as u64,
                sha256: sha256(bean_text.as_bytes()),
            },
            ManifestOutput {
                path: REPORT_FILE.into(),
                byte_length: report_bytes.len() as u64,
                sha256: sha256(&report_bytes),
            },
        ],
    };
    let mut manifest_bytes = serde_json::to_vec(&manifest)
        .map_err(|_| "manifest_serialization_failed")?;
    manifest_bytes.push(b'\n');
    if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("manifest_too_large".into());
    }
    let manifest_relative_path = format!("{stage_relative_path}/{MANIFEST_FILE}");
    let manifest_path = guarded_file_path(root, &manifest_relative_path)?;
    write_new_file(&manifest_path, &manifest_bytes)?;
    sync_directory_if_supported(&stage_directory);

    Ok(StagedMaterialization {
        generation,
        manifest_sha256: sha256(&manifest_bytes),
        output_paths: vec![
            format!("{MATERIALIZED_DIR}/generation-{generation}/{MAIN_FILE}"),
            format!("{MATERIALIZED_DIR}/generation-{generation}/{REPORT_FILE}"),
        ],
        stage_relative_path,
        manifest_bytes,
    })
}

/// Publish a validated generation. The caller must hold the shared Finance
/// write lock and pass the database generation read under that lock.
pub(crate) fn publish_materialization(
    root: &IsolatedWorkspaceRoot,
    staged: &StagedMaterialization,
    _write_guard: &MutexGuard<'static, ()>,
    current_generation: u64,
) -> Result<MaterializationResult, String> {
    if current_generation != staged.generation {
        return Err("stale_materialization_generation".into());
    }
    if sha256(&staged.manifest_bytes) != staged.manifest_sha256 {
        return Err("staged_manifest_hash_mismatch".into());
    }
    let stage_relative_path = normalized_materialized_relative(&staged.stage_relative_path)?;
    let stage_directory = guarded_directory_path(root, &stage_relative_path)?;
    verify_generation_files(root, &stage_relative_path, staged.generation, &staged.manifest_bytes)?;

    let generation_relative_path = format!("{MATERIALIZED_DIR}/generation-{}", staged.generation);
    let generation_directory = match guarded_directory_path(root, &generation_relative_path) {
        Ok(path) => {
            verify_generation_files(
                root,
                &generation_relative_path,
                staged.generation,
                &staged.manifest_bytes,
            )?;
            path
        }
        Err(_) => {
            let target = guarded_file_path(root, &format!("{generation_relative_path}/{MAIN_FILE}"))?;
            if target.exists() {
                return Err("generation_output_collision".into());
            }
            rename_new_generation(&stage_directory, &target.parent().ok_or("generation_path_invalid")?)?;
            guarded_directory_path(root, &generation_relative_path)?
        }
    };
    let _ = generation_directory;

    let active_relative_path = format!("{MATERIALIZED_DIR}/{ACTIVE_MANIFEST}");
    let active_path = guarded_file_path(root, &active_relative_path)?;
    let active_state = read_active_manifest(root, &active_relative_path)?;
    match active_state {
        Some((existing_generation, existing_hash)) if existing_generation > staged.generation => {
            verify_active_generation(root, existing_generation, &existing_hash)?;
            return Err("stale_materialization_generation".into());
        }
        Some((existing_generation, existing_hash)) if existing_generation == staged.generation => {
            verify_active_generation(root, existing_generation, &existing_hash)?;
            if existing_hash != staged.manifest_sha256 {
                return Err("generation_manifest_conflict".into());
            }
            cleanup_staged_directory(root, staged)?;
            return Ok(MaterializationResult {
                generation: staged.generation,
                manifest_sha256: staged.manifest_sha256.clone(),
                active_manifest_path: active_relative_path,
                output_paths: staged.output_paths.clone(),
            });
        }
        Some((existing_generation, existing_hash)) => {
            verify_active_generation(root, existing_generation, &existing_hash)?;
        }
        None => {}
    }

    let temporary_name = format!("{MATERIALIZED_DIR}/.active-manifest-{}.tmp", Uuid::new_v4());
    let temporary_path = guarded_file_path(root, &temporary_name)?;
    write_new_file(&temporary_path, &staged.manifest_bytes)?;
    guarded_file_path(root, &active_relative_path)?;
    replace_active_manifest(&temporary_path, &active_path)?;

    let (published_generation, published_hash) =
        read_active_manifest(root, &active_relative_path)?.ok_or("active_manifest_missing_after_publish")?;
    if published_generation != staged.generation || published_hash != staged.manifest_sha256 {
        return Err("active_manifest_verification_failed".into());
    }
    cleanup_staged_directory(root, staged)?;
    Ok(MaterializationResult {
        generation: staged.generation,
        manifest_sha256: staged.manifest_sha256.clone(),
        active_manifest_path: active_relative_path,
        output_paths: staged.output_paths.clone(),
    })
}

fn verify_projection_inputs(
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
    report: &ReportProjection,
    generation: u64,
) -> Result<(), String> {
    if generation == 0
        || snapshot.generation != generation
        || ledger.generation != generation
        || report.generation != generation
    {
        return Err("projection_generation_mismatch".into());
    }
    let recomputed_ledger = project_ledger(snapshot).map_err(|_| "projection_recompute_failed")?;
    if recomputed_ledger != *ledger {
        return Err("ledger_projection_mismatch".into());
    }
    let recomputed_report = project_reports(snapshot, &recomputed_ledger)
        .map_err(|_| "report_projection_recompute_failed")?;
    if recomputed_report != *report {
        return Err("report_projection_mismatch".into());
    }
    Ok(())
}

fn resolve_used_account_paths(
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
    report: &ReportProjection,
) -> Result<BTreeMap<Id, String>, String> {
    let mut used_ids = BTreeSet::new();
    for transaction in &ledger.transactions {
        for posting in &transaction.postings {
            if let ProjectedAccount::Formal(id) = &posting.account {
                used_ids.insert(id.clone());
            }
        }
    }
    for balance in &report.daily_balances {
        if balance.quantity.is_some() {
            used_ids.insert(balance.account_id.clone());
        }
    }
    for delta in &report.calibration_deltas {
        used_ids.insert(delta.account_id.clone());
    }
    for total in &report.income_expense_totals {
        used_ids.insert(total.account_id.clone());
    }
    for total in &report.settlement_totals {
        used_ids.insert(total.account_id.clone());
    }

    let accounts = snapshot
        .accounts
        .iter()
        .map(|account| (account.id.clone(), account))
        .collect::<BTreeMap<_, _>>();
    let mut path_to_ids = BTreeMap::<String, Vec<Id>>::new();
    for account in &snapshot.accounts {
        if let Some(path) = &account.bean_path {
            path_to_ids.entry(path.clone()).or_default().push(account.id.clone());
        }
    }

    let mut resolved = BTreeMap::new();
    for id in &used_ids {
        let account = accounts.get(id).ok_or("used_account_missing")?;
        let path = account.bean_path.as_deref().ok_or("used_account_path_missing")?;
        validate_account_path(path, account.kind)?;
        if path_to_ids
            .get(path)
            .is_some_and(|ids| ids.iter().any(|other| other != id))
        {
            return Err("duplicate_formal_account_path".into());
        }
        resolved.insert(id.clone(), path.to_owned());
    }
    Ok(resolved)
}

fn validate_account_path(path: &str, kind: AccountKind) -> Result<(), String> {
    let expected_root = match kind {
        AccountKind::Assets => "Assets",
        AccountKind::Liabilities => "Liabilities",
        AccountKind::Equity => "Equity",
        AccountKind::Income => "Income",
        AccountKind::Expenses => "Expenses",
    };
    let components = path.split(':').collect::<Vec<_>>();
    if components.len() < 2 || components[0] != expected_root {
        return Err("account_path_kind_root_mismatch".into());
    }
    if components.iter().any(|part| {
        part.is_empty()
            || !part.as_bytes()[0].is_ascii_uppercase()
            || !part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    }) {
        return Err("account_path_invalid".into());
    }
    Ok(())
}

fn render_ledger(
    snapshot: &LedgerSnapshot,
    ledger: &LedgerProjection,
    report: &ReportProjection,
    generation: u64,
    account_paths: &BTreeMap<Id, String>,
) -> Result<String, String> {
    let mut events = Vec::<RenderEvent>::new();
    let mut event_bytes = 0usize;
    let mut open_dates = BTreeMap::<String, BusinessDate>::new();
    let mut balance_movements = BTreeMap::<(Id, String, BusinessDate), Amount>::new();

    for transaction in &ledger.transactions {
        for posting in &transaction.postings {
            if let ProjectedAccount::Formal(id) = &posting.account {
                let path = account_paths.get(id).ok_or("used_account_path_missing")?;
                add_open_path_dates(&mut open_dates, path, transaction.business_date);
                let commodity = posting.quantity.commodity.as_str().to_owned();
                validate_commodity(&commodity)?;
                let key = (id.clone(), commodity, transaction.business_date);
                let prior = balance_movements.get(&key).copied().unwrap_or(Amount::new(0, 0).map_err(|_| "amount_zero_invalid")?);
                balance_movements.insert(
                    key,
                    prior
                        .checked_add(posting.quantity.amount)
                        .map_err(|_| "balance_movement_overflow")?,
                );
            } else if let ProjectedAccount::RefundTimingEquity { commodity } = &posting.account {
                validate_commodity(commodity)?;
                let path = refund_equity_path(commodity);
                add_open_path_dates(&mut open_dates, &path, transaction.business_date);
            }
        }
        let (text, used_paths) = render_projected_transaction(transaction, account_paths, generation)?;
        for path in used_paths {
            add_open_path_dates(&mut open_dates, &path, transaction.business_date);
        }
        push_render_event(&mut events, &mut event_bytes, RenderEvent {
            date: transaction.business_date,
            rank: 2,
            key: format!("projected:{}", transaction.source_facts.first().map(|fact| fact.id.as_str()).unwrap_or("")),
            text,
        })?;
    }

    let mut first_known_balances = BTreeMap::<(Id, String), (BusinessDate, Quantity, Vec<Id>)>::new();
    for balance in &report.daily_balances {
        let Some(quantity) = &balance.quantity else {
            if balance.basis != BalanceBasis::UnknownNoCalibration {
                return Err("unknown_balance_basis_mismatch".into());
            }
            continue;
        };
        if balance.basis == BalanceBasis::UnknownNoCalibration {
            return Err("known_balance_basis_mismatch".into());
        }
        validate_commodity(&balance.commodity)?;
        let path = account_paths
            .get(&balance.account_id)
            .ok_or("balance_account_path_missing")?;
        let account = snapshot
            .accounts
            .iter()
            .find(|account| account.id == balance.account_id)
            .ok_or("balance_account_missing")?;
        if !matches!(account.kind, AccountKind::Assets | AccountKind::Liabilities) {
            return Err("balance_account_not_funds".into());
        }
        let bean_date = next_business_date(balance.business_date)?;
        let text = format!(
            "{} balance {}  {} {}",
            bean_date.as_string(),
            path,
            quantity.amount.to_decimal_string(),
            balance.commodity
        );
        push_render_event(&mut events, &mut event_bytes, RenderEvent {
            date: bean_date,
            rank: 1,
            key: format!("balance:{}:{}", balance.account_id, balance.commodity),
            text,
        })?;
        first_known_balances
            .entry((balance.account_id.clone(), balance.commodity.clone()))
            .and_modify(|current| {
                if balance.business_date < current.0 {
                    *current = (
                        balance.business_date,
                        quantity.clone(),
                        balance.calibration_point_ids.clone(),
                    );
                }
            })
            .or_insert_with(|| {
                (
                    balance.business_date,
                    quantity.clone(),
                    balance.calibration_point_ids.clone(),
                )
            });
    }

    for ((account_id, commodity), (date, end_balance, anchor_ids)) in first_known_balances {
        let movement = balance_movements
            .get(&(account_id.clone(), commodity.clone(), date))
            .copied()
            .unwrap_or(Amount::new(0, 0).map_err(|_| "amount_zero_invalid")?);
        let opening = end_balance
            .amount
            .checked_sub(movement)
            .map_err(|_| "calibration_opening_overflow")?;
        if opening.is_zero() {
            continue;
        }
        let formal_path = account_paths
            .get(&account_id)
            .ok_or("calibration_account_path_missing")?;
        let calibration_path = calibration_equity_path(&commodity);
        reject_internal_path_collision(snapshot, &calibration_path)?;
        add_open_path_dates(&mut open_dates, formal_path, date);
        add_open_path_dates(&mut open_dates, &calibration_path, date);
        let text = render_balancing_transaction(
            date,
            "Finance v2 calibration opening",
            "Derived from the first E4-known balance",
            &[
                (formal_path.to_owned(), opening, commodity.clone()),
                (
                    calibration_path,
                    opening.checked_neg().map_err(|_| "calibration_opening_overflow")?,
                    commodity.clone(),
                ),
            ],
            &[("orbita-calibration-role", "opening".into()), ("orbita-anchor-ids", join_ids(&anchor_ids))],
        )?;
        push_render_event(&mut events, &mut event_bytes, RenderEvent {
            date,
            rank: 2,
            key: format!("calibration-opening:{account_id}:{commodity}"),
            text,
        })?;
    }

    for delta in &report.calibration_deltas {
        validate_commodity(&delta.commodity)?;
        if delta.amount.commodity.as_str() != delta.commodity {
            return Err("calibration_delta_commodity_mismatch".into());
        }
        if delta.amount.amount.is_zero() {
            return Err("calibration_delta_zero".into());
        }
        if next_business_date(delta.effective_date)? != delta.bean_balance_date {
            return Err("calibration_balance_date_mismatch".into());
        }
        let formal_path = account_paths
            .get(&delta.account_id)
            .ok_or("calibration_account_path_missing")?;
        let calibration_path = calibration_equity_path(&delta.commodity);
        reject_internal_path_collision(snapshot, &calibration_path)?;
        add_open_path_dates(&mut open_dates, formal_path, delta.effective_date);
        add_open_path_dates(&mut open_dates, &calibration_path, delta.effective_date);
        let text = render_balancing_transaction(
            delta.effective_date,
            "Finance v2 calibration delta",
            "Derived from consecutive E4 calibration anchors",
            &[
                (
                    formal_path.to_owned(),
                    delta.amount.amount,
                    delta.commodity.clone(),
                ),
                (
                    calibration_path,
                    delta.amount.amount.checked_neg().map_err(|_| "calibration_delta_overflow")?,
                    delta.commodity.clone(),
                ),
            ],
            &[
                ("orbita-calibration-role", "delta".into()),
                ("orbita-previous-anchor", delta.previous_point_id.to_string()),
                ("orbita-anchor", delta.point_id.to_string()),
                ("orbita-anchor-revision", delta.point_revision.to_string()),
            ],
        )?;
        push_render_event(&mut events, &mut event_bytes, RenderEvent {
            date: delta.effective_date,
            rank: 2,
            key: format!("calibration-delta:{}:{}", delta.account_id, delta.point_id),
            text,
        })?;
    }

    let formal_paths = account_paths.values().cloned().collect::<BTreeSet<_>>();
    let generated_paths = open_dates.keys().cloned().collect::<BTreeSet<_>>();
    for path in &generated_paths {
        if path.starts_with("Equity:Orbita:RefundTiming:")
            || path.starts_with("Equity:Orbita:Calibration:")
        {
            if formal_paths.contains(path) {
                return Err("internal_equity_path_collision".into());
            }
        }
    }
    for (path, date) in &open_dates {
        push_render_event(&mut events, &mut event_bytes, RenderEvent {
            date: *date,
            rank: 0,
            key: format!("open:{path}"),
            text: format!("{} open {path}", date.as_string()),
        })?;
    }
    events.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then(left.rank.cmp(&right.rank))
            .then(left.key.cmp(&right.key))
    });
    let mut output = String::new();
    for event in events {
        append_bounded(&mut output, &event.text)?;
        append_bounded(&mut output, "")?;
    }
    if output.is_empty() {
        append_bounded(&mut output, "")?;
    }
    let _ = generation;
    Ok(output)
}

fn render_projected_transaction(
    transaction: &ProjectedTransaction,
    account_paths: &BTreeMap<Id, String>,
    generation: u64,
) -> Result<(String, Vec<String>), String> {
    let price_count = transaction
        .postings
        .iter()
        .filter(|posting| posting.total_price.is_some())
        .count();
    if price_count > 1 {
        return Err("multiple_total_price_postings".into());
    }
    let mut lines = vec![format!(
        "{} * {} {}",
        transaction.business_date.as_string(),
        bean_string(&transaction.title)?,
        bean_string(&transaction.notes)?
    )];
    let mut paths = Vec::new();
    for posting in &transaction.postings {
        let account_path = match &posting.account {
            ProjectedAccount::Formal(id) => account_paths
                .get(id)
                .cloned()
                .ok_or("posting_account_path_missing")?,
            ProjectedAccount::RefundTimingEquity { commodity } => {
                validate_commodity(commodity)?;
                refund_equity_path(commodity)
            }
        };
        let commodity = posting.quantity.commodity.as_str();
        validate_commodity(commodity)?;
        let mut line = format!(
            "    {account_path}  {} {commodity}",
            posting.quantity.amount.to_decimal_string()
        );
        if let Some(total_price) = &posting.total_price {
            validate_commodity(total_price.commodity.as_str())?;
            if !total_price.amount.is_positive() {
                return Err("total_price_must_be_positive".into());
            }
            line.push_str(&format!(
                " @@ {} {}",
                total_price.amount.to_decimal_string(),
                total_price.commodity.as_str()
            ));
        }
        lines.push(line);
        paths.push(account_path);
    }
    if transaction.postings.len() < 2 {
        return Err("projected_transaction_too_few_postings".into());
    }
    lines.push(format!(
        "  orbita-generation: {}",
        bean_string(&generation.to_string())?
    ));
    lines.push(format!(
        "  orbita-projection-leg: {}",
        bean_string(projection_leg_name(&transaction.leg))?
    ));
    if let Some(owner) = &transaction.owner {
        lines.push(format!(
            "  orbita-owner: {}",
            bean_string(&format!("{}@{}", owner.id, owner.revision))?
        ));
    }
    let source_facts = transaction
        .source_facts
        .iter()
        .map(|fact| format!("{}@{}", fact.id, fact.revision))
        .collect::<Vec<_>>()
        .join(",");
    lines.push(format!(
        "  orbita-source-facts: {}",
        bean_string(&source_facts)?
    ));
    Ok((lines.join("\n"), paths))
}

fn render_balancing_transaction(
    date: BusinessDate,
    title: &str,
    notes: &str,
    postings: &[(String, Amount, String)],
    metadata: &[(&str, String)],
) -> Result<String, String> {
    if postings.len() != 2 || postings[0].1.checked_add(postings[1].1).map_err(|_| "generated_transaction_overflow")?.is_zero() == false {
        return Err("generated_transaction_unbalanced".into());
    }
    if postings[0].2 != postings[1].2 {
        return Err("generated_transaction_commodity_mismatch".into());
    }
    let mut lines = vec![format!(
        "{} * {} {}",
        date.as_string(),
        bean_string(title)?,
        bean_string(notes)?
    )];
    for (account, amount, commodity) in postings {
        validate_commodity(commodity)?;
        lines.push(format!(
            "    {account}  {} {commodity}",
            amount.to_decimal_string()
        ));
    }
    for (key, value) in metadata {
        lines.push(format!("  {key}: {}", bean_string(value)?));
    }
    Ok(lines.join("\n"))
}

fn projection_leg_name(leg: &crate::finance_v2_projection::ProjectionLeg) -> &'static str {
    use crate::finance_v2_projection::ProjectionLeg;
    match leg {
        ProjectionLeg::Ordinary => "ordinary",
        ProjectionLeg::OwnerMember => "owner-member",
        ProjectionLeg::Merge => "merge",
        ProjectionLeg::RefundPayment => "refund-payment",
        ProjectionLeg::RefundReceipt => "refund-receipt",
    }
}

fn add_open_path_dates(
    open_dates: &mut BTreeMap<String, BusinessDate>,
    path: &str,
    date: BusinessDate,
) {
    let parts = path.split(':').collect::<Vec<_>>();
    for end in 2..=parts.len() {
        let account = parts[..end].join(":");
        open_dates
            .entry(account)
            .and_modify(|existing| *existing = (*existing).min(date))
            .or_insert(date);
    }
}

fn bean_string(value: &str) -> Result<String, String> {
    let mut encoded = String::with_capacity(value.len() + 2);
    encoded.push('"');
    for character in value.chars() {
        match character {
            '"' => encoded.push_str("\\\""),
            '\\' => encoded.push_str("\\\\"),
            '\n' => encoded.push_str("\\n"),
            '\r' => encoded.push_str("\\r"),
            '\t' => encoded.push_str("\\t"),
            control if control.is_control() => return Err("unsupported_text_control_character".into()),
            other => encoded.push(other),
        }
    }
    encoded.push('"');
    Ok(encoded)
}

fn validate_commodity(value: &str) -> Result<(), String> {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return Err("commodity_invalid".into());
    };
    if !first.is_ascii_uppercase()
        || !bytes.all(|byte| {
            byte.is_ascii_uppercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'-' | b'_' | b'.' | b'\'' )
        })
    {
        return Err("commodity_invalid".into());
    }
    Ok(())
}

fn refund_equity_path(commodity: &str) -> String {
    format!("Equity:Orbita:RefundTiming:C{}", hex_upper(commodity.as_bytes()))
}

fn calibration_equity_path(commodity: &str) -> String {
    format!("Equity:Orbita:Calibration:C{}", hex_upper(commodity.as_bytes()))
}

fn hex_upper(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn reject_internal_path_collision(
    snapshot: &LedgerSnapshot,
    generated_path: &str,
) -> Result<(), String> {
    if snapshot
        .accounts
        .iter()
        .any(|account| account.bean_path.as_deref() == Some(generated_path))
    {
        return Err("internal_equity_path_collision".into());
    }
    Ok(())
}

fn join_ids(ids: &[Id]) -> String {
    ids.iter().map(ToString::to_string).collect::<Vec<_>>().join(",")
}

fn next_business_date(date: BusinessDate) -> Result<BusinessDate, String> {
    let next = date
        .as_naive()
        .checked_add_days(Days::new(1))
        .ok_or("balance_date_overflow")?;
    BusinessDate::parse(&next.format("%Y-%m-%d").to_string())
        .map_err(|_| "balance_date_overflow".into())
}

fn append_bounded(output: &mut String, line: &str) -> Result<(), String> {
    let required = output
        .len()
        .checked_add(line.len())
        .and_then(|length| length.checked_add(1))
        .ok_or("rendered_file_too_large")?;
    if required > MAX_RENDERED_FILE_BYTES {
        return Err("rendered_file_too_large".into());
    }
    output.push_str(line);
    output.push('\n');
    Ok(())
}

fn push_render_event(
    events: &mut Vec<RenderEvent>,
    current_bytes: &mut usize,
    event: RenderEvent,
) -> Result<(), String> {
    let size = event.text.len().checked_add(2).ok_or("rendered_file_too_large")?;
    let total = current_bytes
        .checked_add(size)
        .ok_or("rendered_file_too_large")?;
    if total > MAX_RENDERED_FILE_BYTES {
        return Err("rendered_file_too_large".into());
    }
    *current_bytes = total;
    events.push(event);
    Ok(())
}

fn ensure_root_directory(root: &IsolatedWorkspaceRoot, relative: &str) -> Result<PathBuf, String> {
    let probe = format!("{relative}/.path-probe");
    let _ = guarded_root_path(root, &probe).map_err(|_| "materialization_path_guard_failed")?;
    let path = root.path().join(relative);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() && !is_reparse_point(&metadata) && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("materialization_directory_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&path).map_err(|_| "materialization_directory_create_failed")?;
        }
        Err(_) => return Err("materialization_directory_read_failed".into()),
    }
    guarded_directory_path(root, relative)
}

fn create_root_directory(root: &IsolatedWorkspaceRoot, relative: &str) -> Result<PathBuf, String> {
    let probe = format!("{relative}/.path-probe");
    let _ = guarded_root_path(root, &probe).map_err(|_| "materialization_path_guard_failed")?;
    let path = root.path().join(relative);
    fs::create_dir(&path).map_err(|_| "materialization_stage_create_failed")?;
    guarded_directory_path(root, relative)
}

fn guarded_directory_path(root: &IsolatedWorkspaceRoot, relative: &str) -> Result<PathBuf, String> {
    let probe = format!("{relative}/.path-probe");
    let _ = guarded_root_path(root, &probe).map_err(|_| "materialization_path_guard_failed")?;
    let path = root.path().join(relative);
    let metadata = fs::symlink_metadata(&path).map_err(|_| "materialization_directory_missing")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("materialization_directory_invalid".into());
    }
    Ok(path)
}

fn guarded_file_path(root: &IsolatedWorkspaceRoot, relative: &str) -> Result<PathBuf, String> {
    guarded_root_path(root, relative).map_err(|_| "materialization_path_guard_failed".into())
}

fn normalized_materialized_relative(relative: &str) -> Result<&str, String> {
    if !relative.starts_with("materialized/")
        || relative.contains('\\')
        || relative.split('/').any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("materialization_stage_path_invalid".into());
    }
    Ok(relative)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "materialization_file_create_failed")?;
    file.write_all(bytes)
        .map_err(|_| "materialization_file_write_failed")?;
    file.sync_all()
        .map_err(|_| "materialization_file_flush_failed")?;
    Ok(())
}

fn verify_generation_files(
    root: &IsolatedWorkspaceRoot,
    directory_relative: &str,
    generation: u64,
    expected_manifest_bytes: &[u8],
) -> Result<MaterializationManifest, String> {
    let manifest_relative = format!("{directory_relative}/{MANIFEST_FILE}");
    let manifest_path = guarded_file_path(root, &manifest_relative)?;
    let manifest_bytes = read_guarded_file(root, &manifest_relative, MAX_MANIFEST_BYTES)?;
    if manifest_bytes != expected_manifest_bytes {
        return Err("generation_manifest_mismatch".into());
    }
    let manifest: MaterializationManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "generation_manifest_invalid")?;
    if manifest.format_version != 1 || manifest.generation != generation {
        return Err("generation_manifest_invalid".into());
    }
    if manifest.outputs.len() != 2
        || !manifest.outputs.iter().any(|output| output.path == MAIN_FILE)
        || !manifest.outputs.iter().any(|output| output.path == REPORT_FILE)
    {
        return Err("generation_manifest_outputs_invalid".into());
    }
    for output in &manifest.outputs {
        if output.path != MAIN_FILE && output.path != REPORT_FILE {
            return Err("generation_manifest_path_invalid".into());
        }
        let relative = format!("{directory_relative}/{}", output.path);
        let bytes = read_guarded_file(root, &relative, MAX_RENDERED_FILE_BYTES as u64)?;
        if bytes.len() as u64 != output.byte_length || sha256(&bytes) != output.sha256 {
            return Err("generation_output_hash_mismatch".into());
        }
    }
    let _ = manifest_path;
    Ok(manifest)
}

fn read_active_manifest(
    root: &IsolatedWorkspaceRoot,
    relative: &str,
) -> Result<Option<(u64, String)>, String> {
    let path = guarded_file_path(root, relative)?;
    match fs::symlink_metadata(&path) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) => {}
        Ok(_) => return Err("active_manifest_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("active_manifest_read_failed".into()),
    }
    let bytes = read_guarded_file(root, relative, MAX_MANIFEST_BYTES)?;
    let manifest: MaterializationManifest =
        serde_json::from_slice(&bytes).map_err(|_| "active_manifest_invalid")?;
    if manifest.format_version != 1 {
        return Err("active_manifest_invalid".into());
    }
    Ok(Some((manifest.generation, sha256(&bytes))))
}

fn verify_active_generation(
    root: &IsolatedWorkspaceRoot,
    generation: u64,
    active_manifest_hash: &str,
) -> Result<(), String> {
    let relative = format!("{MATERIALIZED_DIR}/generation-{generation}");
    let manifest = read_guarded_file(
        root,
        &format!("{relative}/{MANIFEST_FILE}"),
        MAX_MANIFEST_BYTES,
    )?;
    if sha256(&manifest) != active_manifest_hash {
        return Err("active_generation_manifest_hash_mismatch".into());
    }
    verify_generation_files(root, &relative, generation, &manifest)?;
    Ok(())
}

/// Remove only this invocation's private stage after successful publication.
/// Partial cleanup is retryable while the manifest remains; after removing the
/// manifest, only an empty directory is accepted.
fn cleanup_staged_directory(
    root: &IsolatedWorkspaceRoot,
    staged: &StagedMaterialization,
) -> Result<(), String> {
    let relative = normalized_materialized_relative(&staged.stage_relative_path)
        .map_err(|_| "stage_cleanup_failed_recoverable")?;
    let probe = format!("{MATERIALIZED_DIR}/.cleanup-parent-probe");
    guarded_root_path(root, &probe).map_err(|_| "stage_cleanup_failed_recoverable")?;
    let candidate = root.path().join(relative);
    match fs::symlink_metadata(&candidate) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("stage_cleanup_failed_recoverable".into()),
        Ok(_) => {}
    }
    let directory = guarded_directory_path(root, relative)
        .map_err(|_| "stage_cleanup_failed_recoverable")?;
    let entries = fs::read_dir(&directory)
        .map_err(|_| "stage_cleanup_failed_recoverable")?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name())
                .map_err(|_| "stage_cleanup_failed_recoverable")
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    let known = [MAIN_FILE, REPORT_FILE, MANIFEST_FILE]
        .into_iter()
        .map(std::ffi::OsString::from)
        .collect::<BTreeSet<_>>();
    if !entries.is_subset(&known) {
        return Err("stage_cleanup_failed_recoverable:unknown_entry".into());
    }

    let manifest_relative = format!("{relative}/{MANIFEST_FILE}");
    if entries.contains(std::ffi::OsStr::new(MANIFEST_FILE)) {
        let bytes = read_guarded_file(root, &manifest_relative, MAX_MANIFEST_BYTES)
            .map_err(|_| "stage_cleanup_failed_recoverable")?;
        if bytes != staged.manifest_bytes || sha256(&bytes) != staged.manifest_sha256 {
            return Err("stage_cleanup_failed_recoverable:manifest_mismatch".into());
        }
        let manifest: MaterializationManifest = serde_json::from_slice(&bytes)
            .map_err(|_| "stage_cleanup_failed_recoverable")?;
        if manifest.generation != staged.generation
            || manifest.format_version != 1
            || manifest.outputs.len() != 2
        {
            return Err("stage_cleanup_failed_recoverable:manifest_invalid".into());
        }
        for (name, output) in [(MAIN_FILE, &manifest.outputs[0]), (REPORT_FILE, &manifest.outputs[1])] {
            if output.path != name {
                return Err("stage_cleanup_failed_recoverable:manifest_invalid".into());
            }
            let output_relative = format!("{relative}/{name}");
            if entries.contains(std::ffi::OsStr::new(name)) {
                let content = read_guarded_file(root, &output_relative, MAX_RENDERED_FILE_BYTES as u64)
                    .map_err(|_| "stage_cleanup_failed_recoverable")?;
                if content.len() as u64 != output.byte_length || sha256(&content) != output.sha256 {
                    return Err("stage_cleanup_failed_recoverable:output_mismatch".into());
                }
            }
        }
    } else if entries.contains(std::ffi::OsStr::new(MAIN_FILE))
        || entries.contains(std::ffi::OsStr::new(REPORT_FILE))
    {
        return Err("stage_cleanup_failed_recoverable:manifest_missing".into());
    }

    for name in [MAIN_FILE, REPORT_FILE, MANIFEST_FILE] {
        let filename = std::ffi::OsStr::new(name);
        if !entries.contains(filename) {
            continue;
        }
        let file_relative = format!("{relative}/{name}");
        let path = guarded_file_path(root, &file_relative)
            .map_err(|_| "stage_cleanup_failed_recoverable")?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| "stage_cleanup_failed_recoverable")?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("stage_cleanup_failed_recoverable:entry_invalid".into());
        }
        fs::remove_file(path).map_err(|_| "stage_cleanup_failed_recoverable")?;
    }
    let remaining = fs::read_dir(&directory)
        .map_err(|_| "stage_cleanup_failed_recoverable")?
        .next();
    if remaining.is_some() {
        return Err("stage_cleanup_failed_recoverable:directory_not_empty".into());
    }
    fs::remove_dir(directory).map_err(|_| "stage_cleanup_failed_recoverable")?;
    Ok(())
}

fn read_guarded_file(
    root: &IsolatedWorkspaceRoot,
    relative: &str,
    maximum: u64,
) -> Result<Vec<u8>, String> {
    let path = guarded_file_path(root, relative)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| "materialization_file_missing")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("materialization_file_invalid".into());
    }
    if metadata.len() > maximum {
        return Err("materialization_file_too_large".into());
    }
    let mut file = File::open(&path).map_err(|_| "materialization_file_open_failed")?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "materialization_file_read_failed")?;
    if bytes.len() as u64 > maximum {
        return Err("materialization_file_too_large".into());
    }
    Ok(bytes)
}

fn rename_new_generation(stage: &Path, generation_parent: &Path) -> Result<(), String> {
    let generation_directory = generation_parent;
    #[cfg(windows)]
    {
        use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
        let source = windows::core::HSTRING::from(stage.as_os_str().to_string_lossy().as_ref());
        let destination =
            windows::core::HSTRING::from(generation_directory.as_os_str().to_string_lossy().as_ref());
        unsafe { MoveFileExW(&source, &destination, MOVEFILE_WRITE_THROUGH) }
            .map_err(|_| "generation_directory_publish_failed")?;
    }
    #[cfg(not(windows))]
    fs::rename(stage, generation_directory)
        .map_err(|_| "generation_directory_publish_failed")?;
    Ok(())
}

fn replace_active_manifest(temporary: &Path, active: &Path) -> Result<(), String> {
    match fs::symlink_metadata(active) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) => {}
        Ok(_) => return Err("active_manifest_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(windows)]
            {
                use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};
                let source =
                    windows::core::HSTRING::from(temporary.as_os_str().to_string_lossy().as_ref());
                let destination =
                    windows::core::HSTRING::from(active.as_os_str().to_string_lossy().as_ref());
                unsafe { MoveFileExW(&source, &destination, MOVEFILE_WRITE_THROUGH) }
                    .map_err(|_| "active_manifest_publish_failed")?;
            }
            #[cfg(not(windows))]
            fs::rename(temporary, active).map_err(|_| "active_manifest_publish_failed")?;
            return Ok(());
        }
        Err(_) => return Err("active_manifest_read_failed".into()),
    }

    #[cfg(windows)]
    {
        use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};
        let replaced = windows::core::HSTRING::from(active.as_os_str().to_string_lossy().as_ref());
        let replacement =
            windows::core::HSTRING::from(temporary.as_os_str().to_string_lossy().as_ref());
        unsafe {
            ReplaceFileW(
                &replaced,
                &replacement,
                windows::core::PCWSTR::null(),
                REPLACE_FILE_FLAGS(0),
                None,
                None,
            )
        }
        .map_err(|_| "active_manifest_replace_failed")?;
    }
    #[cfg(not(windows))]
    fs::rename(temporary, active).map_err(|_| "active_manifest_replace_failed")?;
    Ok(())
}

fn validate_beancount(
    root: &IsolatedWorkspaceRoot,
    stage_directory: &Path,
    main_path: &Path,
) -> Result<(), String> {
    let manifest_path = env!("CARGO_MANIFEST_DIR");
    let python = Path::new(manifest_path).join("../python/.venv/Scripts/python.exe");
    let python_metadata = fs::symlink_metadata(&python).map_err(|_| "validator_unavailable")?;
    if !python_metadata.is_file()
        || python_metadata.file_type().is_symlink()
        || is_reparse_point(&python_metadata)
    {
        return Err("validator_unavailable".into());
    }
    let relative_main = main_path
        .strip_prefix(root.path())
        .map_err(|_| "materialization_path_guard_failed")?;
    let relative_main = relative_main
        .to_str()
        .ok_or("materialization_path_not_unicode")?;
    let checked_main = guarded_file_path(root, relative_main)?;

    let mut child = Command::new(&python)
        .arg("-I")
        .arg("-m")
        .arg("beancount.scripts.check")
        .arg("-C")
        .arg("--json")
        .arg(&checked_main)
        .current_dir(stage_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "validator_start_failed")?;
    let stdout = child.stdout.take().ok_or("validator_stdout_unavailable")?;
    let reader = thread::spawn(move || read_capped(stdout, MAX_VALIDATOR_STDOUT_BYTES));
    let deadline = Instant::now() + Duration::from_secs(MAX_VALIDATOR_SECONDS);
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("validator_timeout".into());
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("validator_process_wait_failed".into());
            }
        }
    };
    let captured = reader.join().map_err(|_| "validator_output_read_failed")?;
    if captured.read_failed {
        return Err("validator_output_read_failed".into());
    }
    if exit_status.success() {
        if captured.truncated {
            return Err("validator_protocol_output_capped".into());
        }
        let parsed: serde_json::Value = serde_json::from_slice(&captured.bytes)
            .map_err(|_| "validator_protocol_output_invalid")?;
        if parsed
            .get("errors")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|errors| errors.is_empty())
        {
            return Ok(());
        }
        return Err("validator_protocol_output_invalid".into());
    }
    if captured.truncated {
        return Err("beancount_validation_failed:diagnostics_capped".into());
    }
    let lines = serde_json::from_slice::<serde_json::Value>(&captured.bytes)
        .ok()
        .and_then(|value| value.get("errors").and_then(serde_json::Value::as_array).cloned())
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.get("lineno").and_then(serde_json::Value::as_u64))
                .take(MAX_DIAGNOSTIC_LINES)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    if lines.is_empty() {
        return Err("beancount_validation_failed".into());
    }
    let line_list = lines.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
    Err(format!("beancount_validation_failed:lines={line_list}"))
}

struct CappedOutput {
    bytes: Vec<u8>,
    truncated: bool,
    read_failed: bool,
}

fn read_capped(mut reader: impl Read, maximum: usize) -> CappedOutput {
    let mut bytes = Vec::with_capacity(maximum.min(64 * 1024));
    let mut truncated = false;
    let mut read_failed = false;
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let remaining = maximum.saturating_sub(bytes.len());
                let take = remaining.min(count);
                bytes.extend_from_slice(&buffer[..take]);
                truncated |= take < count;
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                read_failed = true;
                break;
            }
        }
    }
    CappedOutput { bytes, truncated, read_failed }
}

fn sync_directory_if_supported(path: &Path) {
    #[cfg(unix)]
    if let Ok(directory) = File::open(path) {
        let _ = directory.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

struct CappedVecWriter<'a> {
    output: &'a mut Vec<u8>,
    maximum: usize,
}

impl<'a> CappedVecWriter<'a> {
    fn new(output: &'a mut Vec<u8>, maximum: usize) -> Self {
        Self { output, maximum }
    }
}

impl Write for CappedVecWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.output.len().saturating_add(bytes.len()) > self.maximum {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "output limit exceeded",
            ));
        }
        self.output.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x0400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

/// Compact output for the opt-in end-to-end acceptance path. It contains no
/// synthetic account or transaction details.
#[cfg(feature = "finance-v2-test-support")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceV2MaterializationAcceptanceSummary {
    pub generation: u64,
    pub manifest_sha256: String,
    pub output_paths: Vec<String>,
    pub replay_was_idempotent: bool,
    pub recovery_was_idempotent: bool,
}

/// Run the successful E3 apply, E5 receipt transaction, E4 projection, and
/// materialization publication path against one synthetic transaction in a
/// newly-created OS TEMP workspace. This smoke acceptance exercises receipt
/// replay and same-generation publication recovery; it does not exercise the
/// command preflight-before-commit gate or prove zero writes on failure.
#[cfg(feature = "finance-v2-test-support")]
pub fn run_synthetic_finance_v2_materialization_acceptance(
) -> Result<FinanceV2MaterializationAcceptanceSummary, String> {
    use crate::{
        finance_v2_domain::{
            Account, AccountKind, Amount, BusinessDate, BusinessTime, CommodityCode,
            FactStatus, Id, L0Fact, Provenance, Quantity,
        },
        finance_v2_projection::{project_ledger, project_reports},
        finance_v2_store::{
            accounts::{read_account_via_snapshot, save_account},
            commit::{commit_once_verified, CommitResult},
            read::read_ledger_snapshot,
            schema,
            StoreError,
        },
        finance_v2_workspace::{
            prepare_commit_plan, DraftRepository, DraftSnapshot, FactMutation,
            FixedParseSnapshot, IsolatedWorkspaceRoot, LedgerIdentity, WorkspaceIntentPayload,
        },
    };
    use std::{cell::RefCell, fs, path::PathBuf};

    struct OwnedTemp(PathBuf);
    impl Drop for OwnedTemp {
        fn drop(&mut self) {
            let Ok(metadata) = fs::symlink_metadata(&self.0) else {
                return;
            };
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return;
            }
            let (Ok(canonical_temp), Ok(canonical_owned)) = (
                fs::canonicalize(std::env::temp_dir()),
                fs::canonicalize(&self.0),
            ) else {
                return;
            };
            if canonical_owned != self.0
                || canonical_owned == canonical_temp
                || !canonical_owned.starts_with(&canonical_temp)
            {
                return;
            }
            let _ = fs::remove_dir_all(canonical_owned);
        }
    }

    let canonical_temp = fs::canonicalize(std::env::temp_dir())
        .map_err(|error| format!("synthetic_temp_root_unavailable: {error:?}"))?;
    let mut unique_temp = None;
    for _ in 0..8 {
        let candidate = canonical_temp.join(format!(
            "orbita-finance-v2-materialize-{}",
            Uuid::new_v4()
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                unique_temp = match fs::canonicalize(&candidate) {
                    Ok(canonical) => Some(canonical),
                    Err(_) => {
                        let _ = fs::remove_dir_all(&candidate);
                        return Err("synthetic_temp_canonicalize_failed".into());
                    }
                };
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("synthetic_temp_create_failed".into()),
        }
    }
    let owned_temp = OwnedTemp(unique_temp.ok_or("synthetic_temp_name_exhausted")?);
    let workspace_path = owned_temp.0.join("workspace");
    let workspace_id = Id::new();
    let identity = LedgerIdentity::new(format!("finance-v2-test:{}", workspace_id.as_str()))
        .map_err(|error| format!("synthetic_identity_invalid: {error:?}"))?;
    let root = IsolatedWorkspaceRoot::create(&workspace_path, workspace_id, identity)
        .map_err(|error| format!("synthetic_workspace_create_failed: {error:?}"))?;
    let mut connection = super::session::open_store(&root)?;
    {
        let tx = connection
            .transaction()
            .map_err(|error| format!("synthetic_schema_transaction_failed: {error:?}"))?;
        schema::install(&tx)
            .map_err(|error| format!("synthetic_schema_install_failed: {error:?}"))?;
        tx.commit()
            .map_err(|error| format!("synthetic_schema_commit_failed: {error:?}"))?;
    }
    schema::validate(&connection)
        .map_err(|error| format!("synthetic_schema_validation_failed: {error:?}"))?;

    let recorded_at = 1_798_675_200_000_000_i64;
    let cash_id = Id::new();
    let expense_id = Id::new();
    {
        let tx = connection
            .transaction()
            .map_err(|error| format!("synthetic_accounts_transaction_failed: {error:?}"))?;
        save_account(
            &tx,
            &Account {
                id: cash_id.clone(),
                revision: 1,
                name: "Synthetic Test Cash".into(),
                kind: AccountKind::Assets,
                bean_path: Some("Assets:TestCash".into()),
                parent_id: None,
                active: true,
                ever_used: false,
            },
            None,
            recorded_at,
        )
        .map_err(|error| format!("synthetic_cash_account_save_failed: {error:?}"))?;
        save_account(
            &tx,
            &Account {
                id: expense_id.clone(),
                revision: 1,
                name: "Synthetic Test Expense".into(),
                kind: AccountKind::Expenses,
                bean_path: Some("Expenses:TestSpend".into()),
                parent_id: None,
                active: true,
                ever_used: false,
            },
            None,
            recorded_at,
        )
        .map_err(|error| format!("synthetic_expense_account_save_failed: {error:?}"))?;
        tx.commit()
            .map_err(|error| format!("synthetic_accounts_commit_failed: {error:?}"))?;
    }

    let base = {
        let tx = connection
            .unchecked_transaction()
            .map_err(|error| format!("synthetic_snapshot_transaction_failed: {error:?}"))?;
        let snapshot = read_ledger_snapshot(&tx)
            .map_err(|error| format!("synthetic_base_snapshot_failed: {error:?}"))?;
        tx.commit()
            .map_err(|error| format!("synthetic_snapshot_commit_failed: {error:?}"))?;
        snapshot
    };
    let (mapping_revision, bindings) = {
        let tx = connection
            .unchecked_transaction()
            .map_err(|error| format!("synthetic_mapping_transaction_failed: {error:?}"))?;
        let value = read_account_via_snapshot(&tx)
            .map_err(|error| format!("synthetic_mapping_snapshot_failed: {error:?}"))?;
        tx.commit()
            .map_err(|error| format!("synthetic_mapping_commit_failed: {error:?}"))?;
        value
    };
    let fixed_parse = FixedParseSnapshot {
        observations: Vec::new(),
        source_context_id: None,
        source_context_revision: None,
        source_context_provider: None,
        base_ledger_generation: base.generation,
        binding_revision: 0,
        account_via_mapping_revision: mapping_revision,
        captured_account_via_bindings: bindings
            .into_iter()
            .map(|binding| crate::finance_v2_workspace::CapturedAccountViaBinding {
                account_id: binding.account_id,
                via_id: binding.via_id,
                revision: binding.revision,
                active: binding.active,
            })
            .collect(),
        captured_accounts: base.accounts.clone(),
        captured_vias: base.vias.clone(),
    };
    let mut draft = DraftSnapshot::new_manual(&root, fixed_parse)
        .map_err(|error| format!("synthetic_draft_create_failed: {error:?}"))?;
    let business_date = BusinessDate::parse("2026-01-15")
        .map_err(|error| format!("synthetic_date_invalid: {error:?}"))?;
    let amount = Amount::new(1250, 2)
        .map_err(|error| format!("synthetic_amount_invalid: {error:?}"))?;
    let commodity = CommodityCode::parse("USD")
        .map_err(|error| format!("synthetic_commodity_invalid: {error:?}"))?;
    let fact = L0Fact {
        id: Id::new(),
        revision: 1,
        status: FactStatus::Active,
        effective_date: business_date,
        business_time: BusinessTime::date(business_date),
        // E4's endpoint convention places an expense on the positive side
        // and the funding account on the negative side of an ordinary fact.
        positive_account_id: expense_id,
        positive: Quantity::new(amount, commodity.clone()),
        negative_account_id: cash_id,
        negative: Quantity::new(amount, commodity),
        via_id: None,
        title: "Synthetic materialization acceptance".into(),
        notes: "Generated only for the Finance v2 integration acceptance.".into(),
        provenance: Provenance::Manual {
            created_at_utc_micros: recorded_at,
        },
    };
    draft
        .stage_intent(
            WorkspaceIntentPayload::Fact(FactMutation::Create { fact }),
            Vec::new(),
            &base,
        )
        .map_err(|error| format!("synthetic_fact_stage_failed: {error:?}"))?;
    let repository = DraftRepository::open(root.clone());
    draft = repository
        .persist(&draft, 0)
        .map_err(|error| format!("synthetic_draft_persist_failed: {error:?}"))?;
    let plan = prepare_commit_plan(&mut draft, &base)
        .map_err(|error| format!("synthetic_commit_plan_failed: {error:?}"))?;

    let commit_projection_error = RefCell::new(None::<String>);
    let commit_apply_error = RefCell::new(None::<String>);
    let committed: CommitResult = commit_once_verified(
        &mut connection,
        &plan.operation_id,
        &Id::new(),
        &Id::new(),
        &plan.payload_sha256,
        plan.ledger_generation,
        recorded_at,
        |tx| {
            match super::commit_apply::apply_commit_plan(tx, &plan, recorded_at) {
                Ok(applied) => Ok(applied.id_map),
                Err(error) => {
                    let detail = super::commit_apply::take_synthetic_apply_diagnostic()
                        .unwrap_or_else(|| format!("apply_commit_plan: {error:?}"));
                    *commit_apply_error.borrow_mut() = Some(detail);
                    Err(error)
                }
            }
        },
        |_tx, snapshot, ledger| {
            project_reports(snapshot, ledger).map_err(|error| {
                *commit_projection_error.borrow_mut() = Some(format!("report_projection: {error:?}"));
                StoreError::InvalidDomainValue
            })?;
            Ok(())
        },
    )
    .map_err(|error| {
        let detail = commit_projection_error
            .borrow()
            .as_ref()
            .map(|message| format!("; {message}"))
            .unwrap_or_default();
        let apply_detail = commit_apply_error
            .borrow()
            .as_ref()
            .map(|message| format!("; {message}"))
            .unwrap_or_default();
        format!("synthetic_atomic_commit_failed: {error:?}{apply_detail}{detail}")
    })?;
    if committed.already_committed || committed.receipt.generation != 1 {
        return Err("synthetic_commit_result_unexpected".into());
    }

    let snapshot = {
        let tx = connection
            .unchecked_transaction()
            .map_err(|error| format!("synthetic_committed_snapshot_transaction_failed: {error:?}"))?;
        let snapshot = read_ledger_snapshot(&tx)
            .map_err(|error| format!("synthetic_committed_snapshot_failed: {error:?}"))?;
        tx.commit()
            .map_err(|error| format!("synthetic_committed_snapshot_commit_failed: {error:?}"))?;
        snapshot
    };
    let ledger = project_ledger(&snapshot)
        .map_err(|error| format!("synthetic_ledger_projection_failed: {error:?}"))?;
    let report = project_reports(&snapshot, &ledger)
        .map_err(|error| format!("synthetic_report_projection_failed: {error:?}"))?;
    use crate::finance_v2_store::commit::{
        find_job, update_job, MaterializationStatus,
    };
    update_job(
        &mut connection,
        &committed.job.job_id,
        MaterializationStatus::Pending,
        MaterializationStatus::Running,
        None,
        None,
        None,
        recorded_at + 1,
    )
    .map_err(|error| format!("synthetic_job_start_failed: {error:?}"))?;
    let staged = prepare_materialization(&root, &snapshot, &ledger, &report, snapshot.generation)?;
    let write_guard = super::session::finance_v2_write_lock()?;
    let published = publish_materialization(&root, &staged, &write_guard, snapshot.generation)?;
    let active = read_active_manifest(
        &root,
        &format!("{MATERIALIZED_DIR}/{ACTIVE_MANIFEST}"),
    )?
    .ok_or("synthetic_active_manifest_missing")?;
    if active.0 != published.generation || active.1 != published.manifest_sha256 {
        return Err("synthetic_active_manifest_mismatch".into());
    }
    verify_active_generation(&root, active.0, &active.1)?;

    // Mirror the durable lifecycle around publication, then exercise both
    // idempotent receipt replay and same-generation materialization recovery.
    update_job(
        &mut connection,
        &committed.job.job_id,
        MaterializationStatus::Running,
        MaterializationStatus::Ready,
        Some(&published.manifest_sha256),
        None,
        None,
        recorded_at + 2,
    )
    .map_err(|error| format!("synthetic_job_ready_failed: {error:?}"))?;
    let ready_job = find_job(&connection, &committed.job.job_id)
        .map_err(|error| format!("synthetic_ready_job_read_failed: {error:?}"))?
        .ok_or("synthetic_ready_job_missing")?;
    if ready_job.status != MaterializationStatus::Ready
        || ready_job.output_sha256.as_deref() != Some(published.manifest_sha256.as_str())
    {
        return Err("synthetic_ready_job_mismatch".into());
    }

    let replay = commit_once_verified(
        &mut connection,
        &plan.operation_id,
        &Id::new(),
        &Id::new(),
        &plan.payload_sha256,
        plan.ledger_generation,
        recorded_at + 3,
        |_tx| Err(StoreError::OperationConflict),
        |_tx, _snapshot, _ledger| Ok(()),
    )
    .map_err(|error| format!("synthetic_commit_replay_failed: {error:?}"))?;
    if !replay.already_committed
        || replay.receipt.receipt_id != committed.receipt.receipt_id
        || replay.job.job_id != committed.job.job_id
        || replay.receipt.generation != committed.receipt.generation
        || replay.job.status != MaterializationStatus::Ready
    {
        return Err("synthetic_commit_replay_not_idempotent".into());
    }

    let recovery_stage = prepare_materialization(&root, &snapshot, &ledger, &report, snapshot.generation)?;
    let recovered = publish_materialization(&root, &recovery_stage, &write_guard, snapshot.generation)?;
    let recovery_was_idempotent = recovered.generation == published.generation
        && recovered.manifest_sha256 == published.manifest_sha256
        && recovered.output_paths == published.output_paths;
    if !recovery_was_idempotent {
        return Err("synthetic_materialization_recovery_not_idempotent".into());
    }
    drop(write_guard);
    drop(connection);
    drop(owned_temp);
    Ok(FinanceV2MaterializationAcceptanceSummary {
        generation: published.generation,
        manifest_sha256: published.manifest_sha256,
        output_paths: published.output_paths,
        replay_was_idempotent: replay.already_committed,
        recovery_was_idempotent,
    })
}
