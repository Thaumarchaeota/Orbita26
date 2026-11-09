use super::error::SnapshotError;
use super::types::{RawSourceFieldValue, RawSourceRecord, SourceOccurrenceRef};

const RAW_TEXT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceRowSnapshot {
    source_ref: SourceOccurrenceRef,
    profile_id: String,
    profile_revision: String,
    raw_text_version: u32,
    raw_text: String,
}

impl SourceRowSnapshot {
    pub fn new(
        source_ref: SourceOccurrenceRef,
        profile_id: impl Into<String>,
        profile_revision: impl Into<String>,
        record: RawSourceRecord,
    ) -> Result<Self, SnapshotError> {
        validate_source_ref(&source_ref)?;

        let profile_id = profile_id.into();
        validate_non_blank(&profile_id, SnapshotError::EmptyProfileId)?;

        let profile_revision = profile_revision.into();
        validate_non_blank(
            &profile_revision,
            SnapshotError::EmptyProfileRevision,
        )?;

        let raw_text = encode_record(record)?;

        Ok(Self {
            source_ref,
            profile_id,
            profile_revision,
            raw_text_version: RAW_TEXT_VERSION,
            raw_text,
        })
    }

    pub fn source_ref(&self) -> &SourceOccurrenceRef {
        &self.source_ref
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn profile_revision(&self) -> &str {
        &self.profile_revision
    }

    pub fn raw_text_version(&self) -> u32 {
        self.raw_text_version
    }

    pub fn raw_text(&self) -> &str {
        &self.raw_text
    }
}

fn validate_source_ref(source_ref: &SourceOccurrenceRef) -> Result<(), SnapshotError> {
    validate_non_blank(
        source_ref.artifact_id(),
        SnapshotError::EmptyArtifactId,
    )?;
    validate_non_blank(source_ref.locator(), SnapshotError::EmptyLocator)?;
    validate_non_blank(
        source_ref.occurrence_discriminator(),
        SnapshotError::EmptyOccurrenceDiscriminator,
    )
}

fn validate_non_blank(value: &str, error: SnapshotError) -> Result<(), SnapshotError> {
    if value.trim().is_empty() {
        Err(error)
    } else {
        Ok(())
    }
}

fn encode_record(record: RawSourceRecord) -> Result<String, SnapshotError> {
    match record {
        RawSourceRecord::Fields(fields) => {
            if fields.is_empty() {
                return Err(SnapshotError::EmptyRecord);
            }

            let encoded = fields
                .into_iter()
                .map(|field| {
                    let name = encode_json_string(field.name());
                    let value = match field.value() {
                        RawSourceFieldValue::Text(value) => encode_json_string(value),
                        RawSourceFieldValue::Empty => encode_json_string(""),
                        RawSourceFieldValue::Missing => String::from("<missing>"),
                    };
                    format!("{name}={value}")
                })
                .collect::<Vec<_>>()
                .join(" | ");

            Ok(encoded)
        }
        RawSourceRecord::Text(text) => Ok(encode_json_string(&text)),
    }
}

fn encode_json_string(value: &str) -> String {
    serde_json::to_string(value)
        .expect("serializing a Rust string to JSON cannot fail")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}
