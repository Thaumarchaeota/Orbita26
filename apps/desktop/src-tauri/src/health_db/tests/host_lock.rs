use crate::health_db::host_lock;

#[test]
fn host_single_flight_lock_rejects_second_acquire() {
    host_lock::release();
    assert!(host_lock::try_acquire());
    assert!(host_lock::is_active());
    assert!(!host_lock::try_acquire());
    host_lock::release();
    assert!(!host_lock::is_active());
    assert!(host_lock::try_acquire());
    host_lock::release();
}
