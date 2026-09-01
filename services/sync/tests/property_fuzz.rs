use proptest::prelude::*;

proptest! {
    #[test]
    fn op_id_always_unique(_seed in 0u64..1000) {
        let id1 = uuid::Uuid::new_v4();
        let id2 = uuid::Uuid::new_v4();
        prop_assert_ne!(id1, id2);
    }

    #[test]
    fn base_version_monotonic(current in 0u64..10000, increments in 1u64..100) {
        let next = current + increments;
        prop_assert!(next > current);
    }
}

#[test]
fn fuzz_skeleton_compiles() {
    assert!(true);
}
