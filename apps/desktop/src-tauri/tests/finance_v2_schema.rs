#![cfg(feature = "finance-v2-test-support")]

use std::{fs, path::{Path, PathBuf}};

use orbita_lib::finance_v2_test_support::{
    create_isolated_environment, schema_sql_equivalent, validate_isolated_environment_schema,
};
use uuid::Uuid;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> Self {
        let path = std::env::temp_dir().join(format!("orbita-finance-v2-schema-it-{}", Uuid::new_v4()));
        fs::create_dir(&path).expect("create this test's unique temporary directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn cleanup(self) {
        fs::remove_dir_all(&self.0).expect("remove only this test's unique temporary directory");
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        // A fresh UUID directory owned by this test, never a user-selected ledger.
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn sql_canonicalization_preserves_literal_bytes_and_normalizes_only_sql_syntax() {
    assert!(!schema_sql_equivalent("status = 'active'", "status = 'ACTIVE'"));
    assert!(!schema_sql_equivalent("label = 'two  spaces'", "label = 'two spaces'"));

    assert!(schema_sql_equivalent(
        "CREATE UNIQUE INDEX ix ON t(status) WHERE status = 'active';",
        "create\n unique   index ix on t(status)\nwhere status = 'active'",
    ));
}

#[test]
fn schema_validator_rejects_a_partial_index_with_changed_status_literal() {
    let temp = TestDirectory::create();
    let root_path = temp.path().join("workspace");
    create_isolated_environment(&root_path).expect("create fresh schema through production helper");
    validate_isolated_environment_schema(&root_path)
        .expect("unchanged fresh schema should pass the production validator");

    let connection = rusqlite::Connection::open(root_path.join("finance-v2.sqlite3"))
        .expect("open only this test's synthetic database");
    connection
        .execute_batch(
            r#"
            DROP INDEX finance_v2_evidence_link_refund_unique;
            CREATE UNIQUE INDEX finance_v2_evidence_link_refund_unique
            ON finance_v2_evidence_link_current(evidence_id, observed_account_id, observation_role)
            WHERE relation_kind = 'refund' AND status = 'ACTIVE';
            "#,
        )
        .expect("replace the synthetic index with a literal-case mutation");
    drop(connection);

    assert!(validate_isolated_environment_schema(&root_path).is_err());
    temp.cleanup();
}
