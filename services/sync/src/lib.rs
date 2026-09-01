pub mod diagnostics;
pub mod api;
pub mod auth;
pub mod canonical;
pub mod config;
pub mod connectors;
pub mod db;
pub mod health;
pub mod metrics;
pub mod redaction;
pub mod retention;
pub mod sync;
pub mod tools;

pub use connectors::garmin;
pub use connectors::ticktick;

use std::sync::Arc;

use anyhow::Result;
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;

use crate::api::routes;
use crate::auth::AppState;
use crate::config::Config;
use crate::db::Database;
use crate::metrics::Metrics;
use crate::retention::RetentionWorker;

pub async fn run_server(config: Config) -> Result<()> {
    init_tracing(&config)?;
    config.validate_startup()?;

    let db = Database::open(&config)?;
    let metrics = Arc::new(Metrics::new());
    let state = Arc::new(AppState {
        db: db.clone(),
        metrics: metrics.clone(),
    });

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let retention = RetentionWorker::new(db.clone(), shutdown_rx);
    let retention_handle = tokio::spawn(retention.run());

    let app = routes::router(state, Arc::new(config.clone()));
    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!(addr = %config.listen_addr, "orbita-sync listening");

    let serve = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    );
    tokio::select! {
        res = serve => res?,
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("shutdown signal received");
        }
    }

    let _ = shutdown_tx.send(true);
    let _ = retention_handle.await;
    Ok(())
}

fn init_tracing(config: &Config) -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .or_else(|_| EnvFilter::try_new(&config.log_level))?;
    tracing_subscriber::fmt().with_env_filter(filter).init();
    Ok(())
}
