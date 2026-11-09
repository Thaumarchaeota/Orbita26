use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SnapshotError {
    EmptyArtifactId,
    EmptyLocator,
    EmptyOccurrenceDiscriminator,
    EmptyProfileId,
    EmptyProfileRevision,
    EmptyRecord,
}

impl fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::EmptyArtifactId => "source artifact ID must not be blank",
            Self::EmptyLocator => "source locator must not be blank",
            Self::EmptyOccurrenceDiscriminator => {
                "source occurrence discriminator must not be blank"
            }
            Self::EmptyProfileId => "source profile ID must not be blank",
            Self::EmptyProfileRevision => "source profile revision must not be blank",
            Self::EmptyRecord => "source record fields must not be empty",
        };

        formatter.write_str(message)
    }
}

impl std::error::Error for SnapshotError {}
