use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use super::error::{DomainError, DomainResult};

static DATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").expect("date regex"));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[serde(tag = "precision", rename_all = "camelCase")]
pub enum ProductivityPoint {
    #[serde(rename = "date")]
    Date { date: String },
    #[serde(rename = "instant")]
    Instant { atUtc: String },
}

pub fn validate_point(point: &ProductivityPoint) -> DomainResult<()> {
    match point {
        ProductivityPoint::Date { date } => {
            if !DATE_RE.is_match(date) {
                return Err(DomainError::invalid_time("date must be YYYY-MM-DD"));
            }
            if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
                return Err(DomainError::invalid_time("invalid calendar date"));
            }
        }
        ProductivityPoint::Instant { atUtc } => {
            validate_utc_instant(atUtc)?;
        }
    }
    Ok(())
}

pub fn validate_utc_instant(value: &str) -> DomainResult<()> {
    if value.is_empty() {
        return Err(DomainError::invalid_time("utc instant required"));
    }
    let parsed = chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    if parsed.offset().local_minus_utc() != 0 {
        return Err(DomainError::invalid_time("instant must be UTC"));
    }
    Ok(())
}

pub fn point_to_json(point: &Option<ProductivityPoint>) -> Option<String> {
    point
        .as_ref()
        .and_then(|p| serde_json::to_string(p).ok())
}

pub fn point_from_json(raw: Option<String>) -> DomainResult<Option<ProductivityPoint>> {
    match raw {
        None => Ok(None),
        Some(s) if s.trim().is_empty() => Ok(None),
        Some(s) => {
            let point: ProductivityPoint = serde_json::from_str(&s)
                .map_err(|_| DomainError::unknown_field_blocked())?;
            validate_point(&point)?;
            Ok(Some(point))
        }
    }
}

pub fn instant_lt(a: &str, b: &str) -> DomainResult<bool> {
    let a = chrono::DateTime::parse_from_rfc3339(a)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let b = chrono::DateTime::parse_from_rfc3339(b)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    Ok(a < b)
}

pub fn range_inside(inner_start: &str, inner_end: &str, outer_start: &str, outer_end: &str) -> DomainResult<bool> {
    let is = chrono::DateTime::parse_from_rfc3339(inner_start)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let ie = chrono::DateTime::parse_from_rfc3339(inner_end)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let os = chrono::DateTime::parse_from_rfc3339(outer_start)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let oe = chrono::DateTime::parse_from_rfc3339(outer_end)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    Ok(is >= os && ie <= oe)
}

pub fn ranges_overlap(a_start: &str, a_end: &str, b_start: &str, b_end: &str) -> DomainResult<bool> {
    let a0 = chrono::DateTime::parse_from_rfc3339(a_start)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let a1 = chrono::DateTime::parse_from_rfc3339(a_end)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let b0 = chrono::DateTime::parse_from_rfc3339(b_start)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    let b1 = chrono::DateTime::parse_from_rfc3339(b_end)
        .map_err(|_| DomainError::invalid_time("invalid utc instant"))?;
    Ok(a0 < b1 && b0 < a1)
}
