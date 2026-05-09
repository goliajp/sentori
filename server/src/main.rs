use std::net::SocketAddr;

use anyhow::Context;
use sentori_server::router;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let token = std::env::var("SENTORI_DEV_TOKEN")
        .context("SENTORI_DEV_TOKEN must be set; see .env.example")?;

    let addr: SocketAddr = "0.0.0.0:8080".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "sentori-server listening");

    let app = router::build(token);
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
