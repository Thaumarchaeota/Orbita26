use super::{Amount, BusinessDate, BusinessTime, Id};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Quantity {
    pub amount: Amount,
    pub commodity: CommodityCode,
}

impl Quantity {
    pub fn new(amount: Amount, commodity: CommodityCode) -> Self {
        Self { amount, commodity }
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CommodityCode(String);

impl CommodityCode {
    pub fn parse(value: impl Into<String>) -> Result<Self, DomainValueError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(DomainValueError::EmptyCommodity);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for CommodityCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: Serializer {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for CommodityCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where D: Deserializer<'de> {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(|_| serde::de::Error::custom("empty commodity code"))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AccountKind {
    Assets,
    Liabilities,
    Equity,
    Income,
    Expenses,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum FactStatus {
    Active,
    Deleted,
    Refined,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CalibrationStatus {
    Active,
    Deleted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Provenance {
    Manual { created_at_utc_micros: i64 },
    Imported { evidence_ids: Vec<Id> },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Account {
    pub id: Id,
    pub revision: u64,
    pub name: String,
    pub kind: AccountKind,
    pub bean_path: Option<String>,
    pub parent_id: Option<Id>,
    pub active: bool,
    pub ever_used: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Via {
    pub id: Id,
    pub revision: u64,
    pub name: String,
    pub active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct L0Fact {
    pub id: Id,
    pub revision: u64,
    pub status: FactStatus,
    pub effective_date: BusinessDate,
    pub business_time: BusinessTime,
    pub positive_account_id: Id,
    pub positive: Quantity,
    pub negative_account_id: Id,
    pub negative: Quantity,
    pub via_id: Option<Id>,
    pub title: String,
    pub notes: String,
    pub provenance: Provenance,
}

impl L0Fact {
    pub fn validate(&self) -> Result<(), DomainValueError> {
        if self.revision == 0 {
            return Err(DomainValueError::InvalidRevision);
        }
        if !self.positive.amount.is_positive() || !self.negative.amount.is_positive() {
            return Err(DomainValueError::L0QuantitiesMustBePositive);
        }
        if self.positive_account_id == self.negative_account_id {
            return Err(DomainValueError::SameEndpointAccount);
        }
        self.business_time
            .validate_effective_date(self.effective_date)
            .map_err(|_| DomainValueError::InvalidBusinessTime)?;
        if self.positive.commodity == self.negative.commodity
            && self.positive.amount.exact_cmp(self.negative.amount).ok()
                != Some(std::cmp::Ordering::Equal)
        {
            return Err(DomainValueError::SameCommodityAmountsMustMatch);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MemberRevision {
    pub l0_id: Id,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MergeGroup {
    pub members: Vec<MemberRevision>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RefundEdge {
    pub refund: MemberRevision,
    pub payment: MemberRevision,
    pub amount: Quantity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Treatment {
    pub id: Id,
    pub revision: u64,
    pub owner_l0_id: Id,
    pub members: Vec<MemberRevision>,
    pub merge_groups: Vec<MergeGroup>,
    pub refund_edges: Vec<RefundEdge>,
    pub title: String,
    pub notes: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CalibrationPoint {
    pub id: Id,
    pub revision: u64,
    pub account_id: Id,
    pub business_date: BusinessDate,
    pub quantity: Quantity,
    pub status: CalibrationStatus,
    pub recorded_at_utc_micros: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LedgerSnapshot {
    pub generation: u64,
    pub accounts: Vec<Account>,
    pub vias: Vec<Via>,
    pub active_leaf_facts: Vec<L0Fact>,
    pub current_treatments: Vec<Treatment>,
    pub calibrations: Vec<CalibrationPoint>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DomainValueError {
    EmptyCommodity,
    InvalidRevision,
    L0QuantitiesMustBePositive,
    SameEndpointAccount,
    SameCommodityAmountsMustMatch,
    InvalidBusinessTime,
}
