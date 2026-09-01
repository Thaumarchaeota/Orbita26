use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;
use tracing::{info, warn};

use crate::db::Database;

/// Single retention worker skeleton. Only one leader should run compaction.
pub struct RetentionWorker {
    db: Arc<Database>,
    shutdown: watch::Receiver<bool>,
    interval: Duration,
}

impl RetentionWorker {
    pub fn new(db: Arc<Database>, shutdown: watch::Receiver<bool>) -> Self {
        Self {
            db,
            shutdown,
            interval: Duration::from_secs(3600),
        }
    }

    pub async fn run(mut self) {
        info!("retention worker started");
        loop {
            tokio::select! {
                _ = tokio::time::sleep(self.interval) => {
                    if let Err(e) = self.tick() {
                        warn!(error = %e, "retention tick failed");
                    }
                }
                changed = self.shutdown.changed() => {
                    if changed.is_ok() && *self.shutdown.borrow() {
                        info!("retention worker stopping");
                        break;
                    }
                }
            }
        }
    }

    fn tick(&self) -> anyhow::Result<()> {
        // Placeholder: tombstone/history compaction policy applied here.
        let _conn = self.db.conn()?;
        info!("retention tick (no-op skeleton)");
        Ok(())
    }
}
