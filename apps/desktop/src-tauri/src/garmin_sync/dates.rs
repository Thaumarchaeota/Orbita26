use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime, Utc};

use super::error::{
    GarminSyncError, GarminSyncResult, GARMIN_RANGE_INVALID, GARMIN_RANGE_TOO_LARGE,
};

pub const TIMEZONE_POLICY: &str = "Asia/Shanghai";
pub const ADVANCED_RANGE_MAX_DAYS: i64 = 3000;

pub fn shanghai_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("UTC+8")
}

pub fn shanghai_today() -> NaiveDate {
    shanghai_today_at(Utc::now())
}

pub fn shanghai_today_at(now: DateTime<Utc>) -> NaiveDate {
    now.with_timezone(&shanghai_offset()).date_naive()
}

/// Daily range is Shanghai today and the previous 6 calendar days.
/// Any `syncDays` argument is ignored (locked 7-day window).
pub fn daily_range(_sync_days: Option<u32>) -> (NaiveDate, NaiveDate, Vec<NaiveDate>) {
    daily_range_on(shanghai_today())
}

pub fn daily_range_on(today: NaiveDate) -> (NaiveDate, NaiveDate, Vec<NaiveDate>) {
    let from = today - Duration::days(6);
    let mut days = Vec::with_capacity(7);
    for i in 0..7 {
        days.push(from + Duration::days(i));
    }
    (from, today, days)
}

pub fn format_ymd(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn parse_ymd_strict(raw: &str) -> GarminSyncResult<NaiveDate> {
    if raw.len() != 10 || raw.as_bytes()[4] != b'-' || raw.as_bytes()[7] != b'-' {
        return Err(GarminSyncError::new(
            GARMIN_RANGE_INVALID,
            "dates must be YYYY-MM-DD",
        ));
    }
    if !raw.bytes().all(|b| b.is_ascii_digit() || b == b'-') {
        return Err(GarminSyncError::new(
            GARMIN_RANGE_INVALID,
            "dates must be YYYY-MM-DD",
        ));
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| {
        GarminSyncError::new(GARMIN_RANGE_INVALID, "dates must be YYYY-MM-DD")
    })
}

pub fn validate_advanced_range(from_date: &str, to_date: &str) -> GarminSyncResult<i64> {
    validate_advanced_range_on(from_date, to_date, shanghai_today())
}

pub fn validate_advanced_range_on(
    from_date: &str,
    to_date: &str,
    today: NaiveDate,
) -> GarminSyncResult<i64> {
    let from = parse_ymd_strict(from_date)?;
    let to = parse_ymd_strict(to_date)?;
    if from > to || to > today {
        return Err(GarminSyncError::new(
            GARMIN_RANGE_INVALID,
            "range is reversed, malformed, or ends after Shanghai today",
        ));
    }
    let days = (to - from).num_days() + 1;
    if days > ADVANCED_RANGE_MAX_DAYS {
        return Err(GarminSyncError::new(
            GARMIN_RANGE_TOO_LARGE,
            format!("inclusive range is {days} days; max is {ADVANCED_RANGE_MAX_DAYS}"),
        ));
    }
    if days < 1 {
        return Err(GarminSyncError::new(
            GARMIN_RANGE_INVALID,
            "range must include at least one day",
        ));
    }
    Ok(days)
}

pub fn shanghai_ymd_from_utc_iso(iso: &str) -> Option<NaiveDate> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(iso) {
        return Some(dt.with_timezone(&shanghai_offset()).date_naive());
    }
    let naive = NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%SZ").ok()?;
    let dt = chrono::TimeZone::from_utc_datetime(&Utc, &naive);
    Some(dt.with_timezone(&shanghai_offset()).date_naive())
}
