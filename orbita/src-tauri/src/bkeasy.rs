use chrono::{Datelike, FixedOffset, Utc};
use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::data;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BkeasySummary {
    pub today: f64,
    pub month: f64,
}

fn bkeasy_root(app: &AppHandle) -> Result<String, String> {
    let settings = data::read_settings(app)?;
    let root = settings.integrations.bkeasy.data_root.trim();
    if root.is_empty() {
        return Ok(data::get_data_dir(app)?);
    }
    Ok(root.to_string())
}

fn ledger_path(root: &str, year: i32) -> PathBuf {
    Path::new(root).join("ledger").join(format!("{year}.bean"))
}

fn beijing_today() -> (String, String) {
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    let now = Utc::now().with_timezone(&tz);
    let today = now.format("%Y-%m-%d").to_string();
    let month_prefix = format!("{}-{:02}", now.year(), now.month());
    (today, month_prefix)
}

pub fn bkeasy_summary(app: &AppHandle) -> Result<BkeasySummary, String> {
    let root = bkeasy_root(app)?;
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    let year = Utc::now().with_timezone(&tz).year();
    let path = ledger_path(&root, year);
    if !path.is_file() {
        return Ok(BkeasySummary {
            today: 0.0,
            month: 0.0,
        });
    }
    let (today, month_prefix) = beijing_today();
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (today_sum, month_sum) = sum_expenses(&raw, &today, &month_prefix);
    Ok(BkeasySummary {
        today: today_sum,
        month: month_sum,
    })
}

fn sum_expenses(raw: &str, today: &str, month_prefix: &str) -> (f64, f64) {
    let header_re = Regex::new(
        r#"^(\d{4}-\d{2}-\d{2})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(.*)$"#,
    )
    .unwrap();
    let posting_re = Regex::new(r"^\s{2,}(\S+)\s*(.*)$").unwrap();
    let meta_re = Regex::new(r#"^\s+bkeasy-type:\s*"([^"]+)"\s*$"#).unwrap();
    let amount_re = Regex::new(r"^(-?\d+(?:\.\d+)?)").unwrap();

    let mut today_sum = 0.0f64;
    let mut month_sum = 0.0f64;
    let mut cur_date = String::new();
    let mut cur_type: Option<String> = None;
    let mut postings: Vec<(String, f64)> = Vec::new();

    let mut flush = |date: &str, entry_type: &Option<String>, postings: &[(String, f64)]| {
        if date.is_empty() {
            return;
        }
        let mut et = entry_type.clone();
        if et.is_none() {
            let has_exp = postings.iter().any(|(a, _)| a.starts_with("Expenses:"));
            if has_exp {
                et = Some("expense".into());
            }
        }
        if et.as_deref() != Some("expense") {
            return;
        }
        let mut expense = 0.0f64;
        for (acct, amt) in postings {
            if acct.starts_with("Expenses:") && *amt > 0.0 {
                expense += *amt;
            }
        }
        if expense <= 0.0 {
            return;
        }
        if date == today {
            today_sum += expense;
        }
        if date.starts_with(month_prefix) {
            month_sum += expense;
        }
    };

    for line in raw.lines() {
        let line = line.trim_end();
        let stripped = line.trim();
        if stripped.is_empty() || stripped.starts_with(';') {
            continue;
        }
        if let Some(hm) = header_re.captures(line) {
            flush(&cur_date, &cur_type, &postings);
            cur_date = hm.get(1).unwrap().as_str().to_string();
            cur_type = None;
            postings.clear();
            continue;
        }
        if cur_date.is_empty() {
            continue;
        }
        if let Some(mm) = meta_re.captures(line) {
            cur_type = Some(mm.get(1).unwrap().as_str().to_string());
            continue;
        }
        if let Some(pm) = posting_re.captures(line) {
            let acct = pm.get(1).unwrap().as_str().to_string();
            let tail = pm.get(2).unwrap().as_str().trim();
            let amt = if tail.is_empty() {
                0.0
            } else if let Some(am) = amount_re.captures(tail) {
                am.get(1).unwrap().as_str().parse().unwrap_or(0.0)
            } else {
                0.0
            };
            postings.push((acct, amt));
        }
    }
    flush(&cur_date, &cur_type, &postings);
    (today_sum, month_sum)
}
