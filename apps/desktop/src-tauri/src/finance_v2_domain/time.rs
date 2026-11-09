use chrono::{DateTime, Datelike, NaiveDate, Utc};
use chrono_tz::Asia::Shanghai;
use std::{fmt, str::FromStr};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BusinessDate(NaiveDate);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum BusinessTime {
    Date { source_date: BusinessDate },
    Instant {
        utc_micros: i64,
        source_date: Option<BusinessDate>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BusinessTimeError {
    InvalidDate,
    InvalidInstant,
    SubMicrosecondPrecision,
    EffectiveDateMismatch,
    YearOutOfRange,
    OutOfRange,
}

impl BusinessDate {
    pub fn parse(value: &str) -> Result<Self, BusinessTimeError> {
        if value.len() != 10
            || value.as_bytes()[4] != b'-'
            || value.as_bytes()[7] != b'-'
            || !value
                .bytes()
                .enumerate()
                .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        {
            return Err(BusinessTimeError::InvalidDate);
        }
        let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| BusinessTimeError::InvalidDate)?;
        Self::from_naive(date)
    }

    pub fn as_naive(self) -> NaiveDate {
        self.0
    }

    pub fn as_string(self) -> String {
        self.0.format("%Y-%m-%d").to_string()
    }

    fn from_naive(date: NaiveDate) -> Result<Self, BusinessTimeError> {
        if !(1..=9999).contains(&date.year()) {
            return Err(BusinessTimeError::YearOutOfRange);
        }
        Ok(Self(date))
    }
}

impl BusinessTime {
    pub fn date(source_date: BusinessDate) -> Self {
        Self::Date { source_date }
    }

    pub fn parse_instant(
        rfc3339_with_offset: &str,
        source_date: Option<BusinessDate>,
    ) -> Result<Self, BusinessTimeError> {
        let parsed = DateTime::parse_from_rfc3339(rfc3339_with_offset)
            .map_err(|_| BusinessTimeError::InvalidInstant)?;
        if parsed.timestamp_subsec_nanos() % 1_000 != 0 {
            return Err(BusinessTimeError::SubMicrosecondPrecision);
        }
        Ok(Self::Instant {
            utc_micros: parsed.timestamp_micros(),
            source_date,
        })
    }

    pub fn from_utc_micros(
        utc_micros: i64,
        source_date: Option<BusinessDate>,
    ) -> Self {
        Self::Instant { utc_micros, source_date }
    }

    pub fn source_date(&self) -> Option<BusinessDate> {
        match self {
            Self::Date { source_date } => Some(*source_date),
            Self::Instant { source_date, .. } => *source_date,
        }
    }

    pub fn utc_micros(&self) -> Option<i64> {
        match self {
            Self::Date { .. } => None,
            Self::Instant { utc_micros, .. } => Some(*utc_micros),
        }
    }

    pub fn validate_effective_date(
        &self,
        effective_date: BusinessDate,
    ) -> Result<(), BusinessTimeError> {
        match self {
            Self::Date { source_date } if *source_date != effective_date => {
                Err(BusinessTimeError::EffectiveDateMismatch)
            }
            Self::Date { .. } => Ok(()),
            Self::Instant { utc_micros, .. } => {
                let utc = DateTime::<Utc>::from_timestamp_micros(*utc_micros)
                    .ok_or(BusinessTimeError::OutOfRange)?;
                let local = utc.with_timezone(&Shanghai);
                let projected = BusinessDate::from_naive(local.date_naive())?;
                if projected != effective_date {
                    return Err(BusinessTimeError::EffectiveDateMismatch);
                }
                Ok(())
            }
        }
    }
}

impl FromStr for BusinessDate {
    type Err = BusinessTimeError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl fmt::Display for BusinessDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.as_string())
    }
}

impl Serialize for BusinessDate {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        serializer.serialize_str(&self.as_string())
    }
}

impl<'de> Deserialize<'de> for BusinessDate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where D: Deserializer<'de> {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(|_| serde::de::Error::custom("invalid four-digit business date"))
    }
}

