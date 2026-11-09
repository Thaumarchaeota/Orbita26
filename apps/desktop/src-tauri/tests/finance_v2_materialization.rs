#![cfg(feature = "finance-v2-test-support")]

use orbita_lib::finance_v2_test_support::run_synthetic_finance_v2_materialization_acceptance;

#[test]
fn synthetic_commit_materializes_and_retry_is_idempotent() {
    let result = run_synthetic_finance_v2_materialization_acceptance()
        .expect("synthetic Finance v2 commit and Beancount materialization should succeed");

    assert_eq!(result.generation, 1);
    assert_eq!(result.manifest_sha256.len(), 64);
    assert!(result.replay_was_idempotent);
    assert!(result.recovery_was_idempotent);
    assert!(result.output_paths.iter().any(|path| path.ends_with("main.bean")));
    assert!(result.output_paths.iter().any(|path| path.ends_with("reports.json")));
}
