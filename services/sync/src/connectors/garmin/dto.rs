use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Daily {
    pub local_date: NaiveDate,
    pub steps: Option<u32>,
    pub active_calories: Option<u32>,
    pub resting_hr: Option<u16>,
    pub stress_avg: Option<u8>,
    pub body_battery_high: Option<u8>,
    pub body_battery_low: Option<u8>,
    pub source: String,
    pub external_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Routine {
    pub wake_date: NaiveDate,
    pub sleep_start: DateTime<Utc>,
    pub sleep_end: DateTime<Utc>,
    pub deep_seconds: u32,
    pub light_seconds: u32,
    pub rem_seconds: u32,
    pub awake_seconds: u32,
    pub source: String,
    pub external_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeriesSnapshot {
    pub local_date: NaiveDate,
    pub metric_name: String,
    pub samples: Vec<SeriesSample>,
    pub source: String,
    pub external_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeriesSample {
    pub ts: DateTime<Utc>,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exercise {
    pub external_id: String,
    pub sport: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub duration_seconds: u32,
    pub distance_meters: Option<u32>,
    pub calories: Option<u32>,
    pub avg_hr: Option<u16>,
    pub source: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BodyMeasurement {
    pub measured_at: DateTime<Utc>,
    pub weight_kg: Option<f64>,
    pub body_fat_pct: Option<f64>,
    pub muscle_mass_kg: Option<f64>,
    pub source: String,
    pub external_id: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FetchWindow {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProbeCapabilities {
    pub daily: bool,
    pub routine: bool,
    pub series: bool,
    pub exercise: bool,
    pub body_measurement: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FetchResult {
    pub dailies: Vec<Daily>,
    pub routines: Vec<Routine>,
    pub series: Vec<SeriesSnapshot>,
    pub exercises: Vec<Exercise>,
    pub body_measurements: Vec<BodyMeasurement>,
}
