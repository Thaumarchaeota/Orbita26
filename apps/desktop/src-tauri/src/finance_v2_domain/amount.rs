use std::{cmp::Ordering, fmt};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub const MAX_SCALE: u8 = 9;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Amount {
    coefficient: i128,
    scale: u8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AmountError {
    Empty,
    InvalidSyntax,
    NegativeZero,
    ScaleOutOfRange,
    Overflow,
}

impl Amount {
    pub fn new(coefficient: i128, scale: u8) -> Result<Self, AmountError> {
        if scale > MAX_SCALE {
            return Err(AmountError::ScaleOutOfRange);
        }
        let (coefficient, scale) = Self::normalize(coefficient, scale);
        Ok(Self { coefficient, scale })
    }

    pub fn parse_decimal(input: &str) -> Result<Self, AmountError> {
        if input.is_empty() {
            return Err(AmountError::Empty);
        }
        if input.starts_with('+') || input.trim() != input {
            return Err(AmountError::InvalidSyntax);
        }
        let (negative, body) = match input.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, input),
        };
        if body.is_empty() || body.contains(['e', 'E']) {
            return Err(AmountError::InvalidSyntax);
        }
        let mut parts = body.split('.');
        let whole = parts.next().unwrap_or_default();
        let fractional = parts.next();
        if parts.next().is_some()
            || whole.is_empty()
            || !whole.bytes().all(|b| b.is_ascii_digit())
            || fractional.is_some_and(|s| !s.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err(AmountError::InvalidSyntax);
        }
        let fractional = fractional.unwrap_or_default();
        if fractional.len() > MAX_SCALE as usize {
            return Err(AmountError::ScaleOutOfRange);
        }
        let digits = format!("{whole}{fractional}");
        let magnitude = digits.parse::<u128>().map_err(|_| AmountError::Overflow)?;
        if negative && magnitude == 0 {
            return Err(AmountError::NegativeZero);
        }
        let coefficient = if negative {
            if magnitude > (i128::MAX as u128) + 1 {
                return Err(AmountError::Overflow);
            }
            if magnitude == (i128::MAX as u128) + 1 {
                i128::MIN
            } else {
                -(magnitude as i128)
            }
        } else {
            i128::try_from(magnitude).map_err(|_| AmountError::Overflow)?
        };
        Self::new(coefficient, fractional.len() as u8)
    }

    pub fn coefficient(self) -> i128 {
        self.coefficient
    }

    pub fn scale(self) -> u8 {
        self.scale
    }

    pub fn is_positive(self) -> bool {
        self.coefficient > 0
    }

    pub fn is_negative(self) -> bool {
        self.coefficient < 0
    }

    pub fn is_zero(self) -> bool {
        self.coefficient == 0
    }

    pub fn checked_add(self, other: Self) -> Result<Self, AmountError> {
        let scale = self.scale.max(other.scale);
        let left = Self::scale_coefficient(self.coefficient, scale - self.scale)?;
        let right = Self::scale_coefficient(other.coefficient, scale - other.scale)?;
        Self::new(left.checked_add(right).ok_or(AmountError::Overflow)?, scale)
    }

    pub fn checked_sub(self, other: Self) -> Result<Self, AmountError> {
        let scale = self.scale.max(other.scale);
        let left = Self::scale_coefficient(self.coefficient, scale - self.scale)?;
        let right = Self::scale_coefficient(other.coefficient, scale - other.scale)?;
        Self::new(left.checked_sub(right).ok_or(AmountError::Overflow)?, scale)
    }

    pub fn checked_neg(self) -> Result<Self, AmountError> {
        Self::new(self.coefficient.checked_neg().ok_or(AmountError::Overflow)?, self.scale)
    }

    pub fn checked_mul_pow10(self, places: u8) -> Result<Self, AmountError> {
        let factor = 10_i128.checked_pow(places as u32).ok_or(AmountError::Overflow)?;
        Self::new(
            self.coefficient.checked_mul(factor).ok_or(AmountError::Overflow)?,
            self.scale,
        )
    }

    pub fn exact_cmp(self, other: Self) -> Result<Ordering, AmountError> {
        let left_negative = self.coefficient < 0;
        let right_negative = other.coefficient < 0;
        if left_negative != right_negative {
            return Ok(if left_negative { Ordering::Less } else { Ordering::Greater });
        }
        let left_text = self.to_decimal_string();
        let right_text = other.to_decimal_string();
        let (left_integer, left_fraction) = left_text.trim_start_matches('-')
            .split_once('.').unwrap_or((left_text.trim_start_matches('-'), ""));
        let (right_integer, right_fraction) = right_text.trim_start_matches('-')
            .split_once('.').unwrap_or((right_text.trim_start_matches('-'), ""));
        let left_integer = left_integer.trim_start_matches('0');
        let right_integer = right_integer.trim_start_matches('0');
        let left_integer = if left_integer.is_empty() { "0" } else { left_integer };
        let right_integer = if right_integer.is_empty() { "0" } else { right_integer };
        let magnitude_order = left_integer.len().cmp(&right_integer.len()).then_with(|| {
            left_integer.cmp(right_integer).then_with(|| {
                let width = left_fraction.len().max(right_fraction.len());
                let left = format!("{left_fraction:0<width$}");
                let right = format!("{right_fraction:0<width$}");
                left.cmp(&right)
            })
        });
        Ok(if left_negative { magnitude_order.reverse() } else { magnitude_order })
    }

    pub fn to_decimal_string(self) -> String {
        let negative = self.coefficient < 0;
        let digits = self.coefficient.unsigned_abs().to_string();
        let result = if self.scale == 0 {
            digits
        } else {
            let scale = self.scale as usize;
            let padded = if digits.len() <= scale {
                format!("{}{}", "0".repeat(scale + 1 - digits.len()), digits)
            } else {
                digits
            };
            let split = padded.len() - scale;
            format!("{}.{}", &padded[..split], &padded[split..])
        };
        if negative { format!("-{result}") } else { result }
    }

    fn scale_coefficient(value: i128, places: u8) -> Result<i128, AmountError> {
        let factor = 10_i128.checked_pow(places as u32).ok_or(AmountError::Overflow)?;
        value.checked_mul(factor).ok_or(AmountError::Overflow)
    }

    fn normalize(mut coefficient: i128, mut scale: u8) -> (i128, u8) {
        while scale > 0 && coefficient % 10 == 0 {
            coefficient /= 10;
            scale -= 1;
        }
        (coefficient, scale)
    }
}

impl fmt::Display for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_decimal_string())
    }
}

impl Serialize for Amount {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        serializer.serialize_str(&self.to_decimal_string())
    }
}

impl<'de> Deserialize<'de> for Amount {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where D: Deserializer<'de> {
        let value = String::deserialize(deserializer)?;
        Self::parse_decimal(&value).map_err(|_| serde::de::Error::custom("invalid canonical amount"))
    }
}
