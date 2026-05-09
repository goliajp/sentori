use std::net::SocketAddr;

use anyhow::Context;
use sentori_server::{db, notifier, router, seed, valkey};

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

    let admin_password = std::env::var("SENTORI_ADMIN_PASSWORD")
        .unwrap_or_else(|_| {
            tracing::warn!("SENTORI_ADMIN_PASSWORD not set; using dev default 'admin'");
            "admin".to_string()
        });
    let session_secret = std::env::var("SENTORI_SESSION_SECRET")
        .unwrap_or_else(|_| {
            tracing::warn!("SENTORI_SESSION_SECRET not set; using dev default (insecure)");
            "dev-only-do-not-use-in-prod".to_string()
        });

    // SMTP notifier — optional. Spawns the loop unconditionally so callers
    // don't need to special-case None; without SMTP_HOST every emit is a
    // best-effort no-op.
    let notifier_cfg = match std::env::var("SENTORI_SMTP_HOST").ok() {
        Some(host) => Some(notifier::NotifierConfig {
            smtp_host: host,
            smtp_port: std::env::var("SENTORI_SMTP_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(587),
            smtp_user: std::env::var("SENTORI_SMTP_USER").ok(),
            smtp_pass: std::env::var("SENTORI_SMTP_PASS").ok(),
            from: std::env::var("SENTORI_SMTP_FROM")
                .unwrap_or_else(|_| "sentori@localhost".to_string()),
        }),
        None => {
            tracing::info!("no SENTORI_SMTP_HOST set; email notifications disabled");
            None
        }
    };
    let notifier_tx = pool
        .as_ref()
        .map(|p| notifier::start(notifier_cfg.clone(), p.clone()));

    let addr: SocketAddr = "0.0.0.0:8080".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "sentori-server listening");

    let app = router::build(router::ServerConfig {
        dev_token: token,
        db: pool,
        valkey,
        project_id: seed::DEV_PROJECT_ID,
        rate_limit_per_min,
        admin_password,
        session_secret,
        notifier_tx,
    });
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
