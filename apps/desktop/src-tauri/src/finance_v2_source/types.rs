#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceOccurrenceRef {
    artifact_id: String,
    locator: String,
    occurrence_discriminator: String,
}

impl SourceOccurrenceRef {
    pub fn new(
        artifact_id: impl Into<String>,
        locator: impl Into<String>,
        occurrence_discriminator: impl Into<String>,
    ) -> Self {
        Self {
            artifact_id: artifact_id.into(),
            locator: locator.into(),
            occurrence_discriminator: occurrence_discriminator.into(),
        }
    }

    pub fn artifact_id(&self) -> &str {
        &self.artifact_id
    }

    pub fn locator(&self) -> &str {
        &self.locator
    }

    pub fn occurrence_discriminator(&self) -> &str {
        &self.occurrence_discriminator
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawSourceFieldValue {
    Text(String),
    Empty,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawSourceField {
    name: String,
    value: RawSourceFieldValue,
}

impl RawSourceField {
    pub fn new(name: impl Into<String>, value: RawSourceFieldValue) -> Self {
        Self {
            name: name.into(),
            value,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn value(&self) -> &RawSourceFieldValue {
        &self.value
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawSourceRecord {
    Fields(Vec<RawSourceField>),
    Text(String),
}
