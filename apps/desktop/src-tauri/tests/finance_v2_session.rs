#![cfg(feature = "finance-v2-test-support")]

use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(windows)]
use std::path::Component;

use orbita_lib::finance_v2_test_support::{
    create_isolated_environment, guard_output_path, open_isolated_environment, validate_path_chain,
};
use uuid::Uuid;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> Self {
        let path = std::env::temp_dir().join(format!("orbita-finance-v2-session-it-{}", Uuid::new_v4()));
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
        // A fresh UUID directory owned by this test; never points at a selected ledger.
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn canonical_path_guard_accepts_complete_root_and_rejects_escape_and_drive_relative() {
    let temp = TestDirectory::create();
    let root_path = temp.path().join("workspace");
    create_isolated_environment(&root_path).expect("create isolated environment through production helper");
    let canonical_root = fs::canonicalize(&root_path).expect("canonicalize isolated root");

    #[cfg(windows)]
    {
        if let Some(Component::Prefix(prefix)) = canonical_root.components().next() {
            let prefix_only = Path::new(prefix.as_os_str());
            let raw_os_error = fs::symlink_metadata(prefix_only).err().and_then(|error| error.raw_os_error());
            println!("synthetic_prefix_metadata_raw_os_error={raw_os_error:?}");
            assert!(canonical_root.to_string_lossy().starts_with("\\\\?\\"));
        }
        assert!(validate_path_chain(Path::new("C:relative\\probe")).is_err());
    }

    validate_path_chain(&canonical_root).expect("complete canonical root should pass path guard");
    assert!(guard_output_path(&root_path, "../outside.txt").is_err());

    temp.cleanup();
}

#[test]
fn isolated_environment_creation_persists_schema_and_reopens_at_generation_zero() {
    let temp = TestDirectory::create();
    let root_path = temp.path().join("workspace");

    create_isolated_environment(&root_path).expect("create marker and install production SQLite schema");
    assert!(root_path.join("finance-v2-workspace.json").is_file());
    assert!(root_path.join("drafts").is_dir());
    assert!(root_path.join("finance-v2.sqlite3").is_file());

    let generation = open_isolated_environment(&root_path)
        .expect("reopen marker-bound root, validate schema, and read generation");
    assert_eq!(generation, 0);

    temp.cleanup();
}
