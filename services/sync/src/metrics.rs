use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default)]
pub struct Metrics {
    pub push_ops_total: AtomicU64,
    pub pull_requests_total: AtomicU64,
    pub conflicts_total: AtomicU64,
    pub dedupe_total: AtomicU64,
    pub errors_total: AtomicU64,
    pub backup_age_seconds: AtomicU64,
}

impl Metrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn inc_push(&self) {
        self.push_ops_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_pull(&self) {
        self.pull_requests_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_conflict(&self) {
        self.conflicts_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_dedupe(&self) {
        self.dedupe_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_error(&self) {
        self.errors_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn set_backup_age_seconds(&self, secs: u64) {
        self.backup_age_seconds.store(secs, Ordering::Relaxed);
    }

    pub fn render_prometheus(&self) -> String {
        format!(
            "# HELP orbita_sync_push_ops_total Push operations processed\n\
             # TYPE orbita_sync_push_ops_total counter\n\
             orbita_sync_push_ops_total {}\n\
             # HELP orbita_sync_pull_requests_total Pull requests\n\
             # TYPE orbita_sync_pull_requests_total counter\n\
             orbita_sync_pull_requests_total {}\n\
             # HELP orbita_sync_conflicts_total Conflicts recorded\n\
             # TYPE orbita_sync_conflicts_total counter\n\
             orbita_sync_conflicts_total {}\n\
             # HELP orbita_sync_dedupe_total Idempotent dedupe hits\n\
             # TYPE orbita_sync_dedupe_total counter\n\
             orbita_sync_dedupe_total {}\n\
             # HELP orbita_sync_errors_total Handler errors\n\
             # TYPE orbita_sync_errors_total counter\n\
             orbita_sync_errors_total {}\n\
             # HELP orbita_sync_backup_age_seconds Age of last backup (placeholder)\n\
             # TYPE orbita_sync_backup_age_seconds gauge\n\
             orbita_sync_backup_age_seconds {}\n",
            self.push_ops_total.load(Ordering::Relaxed),
            self.pull_requests_total.load(Ordering::Relaxed),
            self.conflicts_total.load(Ordering::Relaxed),
            self.dedupe_total.load(Ordering::Relaxed),
            self.errors_total.load(Ordering::Relaxed),
            self.backup_age_seconds.load(Ordering::Relaxed),
        )
    }
}
