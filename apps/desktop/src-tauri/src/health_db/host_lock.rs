// Host single-flight lock per docs/specs/orbita-health-archive.md §4.1
use std::sync::atomic::{AtomicBool, Ordering};

static GARMIN_SYNC_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn try_acquire() -> bool {
    !GARMIN_SYNC_ACTIVE.swap(true, Ordering::SeqCst)
}

pub fn release() {
    GARMIN_SYNC_ACTIVE.store(false, Ordering::SeqCst);
}

pub fn is_active() -> bool {
    GARMIN_SYNC_ACTIVE.load(Ordering::SeqCst)
}
