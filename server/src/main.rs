use std::net::SocketAddr;

use anyhow::Context;
use sentori_server::{db, router, seed, valkey};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let token = std::env::var("SENTORI_DEV_TOKEN")
        .context("SENTORI_DEV_TOKEN must be set; see .env.example")?;

    let pool = match std::env::var("DATABASE_URL").ok() {
        Some(url) => {
            let pool = db::connect(&url).await?;
            seed::ensure_dev_project(&pool).await?;
            tracing::info!("postgres connected, migrations applied, dev project seeded");
            Some(pool)
        }
        None => {
            tracing::info!("no DATABASE_URL set; running in-memory only");
            None
        }
    };

    let valkey = match std::env::var("VALKEY_URL").ok() {
        Some(url) => match valkey::connect(&url).await {
            Ok(c) => {
                tracing::info!("valkey connected; rate limiting enabled");
                Some(c)
            }
            Err(e) => {
                tracing::warn!(error = %e, "valkey connection failed; rate limiting disabled");
                None
            }
        },
        None => {
            tracing::info!("no VALKEY_URL set; rate limiting disabled");
            None
        }
    };

    let rate_limit_per_min: u32 = std::env::var("SENTORI_RATE_LIMIT_PER_MIN")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1000);

    let addr: SocketAddr = "0.0.0.0:8080".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "sentori-server listening");

    let app = router::build(
        token,
        pool,
        valkey,
        seed::DEV_PROJECT_ID,
        rate_limit_per_min,
    );
    axum::serve(listener, app).await?;

    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{EnvFilter, fmt};

    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,sentori_server=debug,tower_http=info")),
        )
        .init();
}
