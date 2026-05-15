use std::net::SocketAddr;

use anyhow::Context;
use sentori_server::{
    db, digest, metrics, notifier, quotas, regression, retention, router, rule_eval, seed,
    trace_emit, valkey, webhook_dispatch,
};

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
            tls: std::env::var("SENTORI_SMTP_TLS")
                .map(|s| notifier::SmtpTls::from_env(&s))
                .unwrap_or(notifier::SmtpTls::Starttls),
        }),
        None => {
            tracing::info!("no SENTORI_SMTP_HOST set; email notifications disabled");
            None
        }
    };
    let notifier_tx = pool
        .as_ref()
        .map(|p| notifier::start(notifier_cfg.clone(), p.clone()));

    // Phase 15 sub-B: rollup the Valkey usage counters into PG every
    // 60s so dashboard / billing / monthly reports always read fresh
    // numbers. Only spawned when both backing stores are configured.
    if let (Some(p), Some(v)) = (pool.as_ref(), valkey.as_ref()) {
        quotas::spawn_flush_task(p.clone(), v.clone());
        tracing::info!("quota flush task spawned (60s interval)");
    }

    // Phase 15 sub-C: daily retention pass — ensure 6 months of future
    // events partitions exist, drop any monthly partition whose upper
    // bound is older than the longest retention period any plan grants.
    if let Some(p) = pool.as_ref() {
        retention::spawn_retention_task(
            p.clone(),
            sentori_server::attachments::build_default_store(),
        );
        tracing::info!("retention task spawned (24h interval)");
    }

    // Phase 23 sub-D: regression sweeper safety net. The ingest path
    // already flips resolved → regressed atomically on every event;
    // this catches rows missed by that path (pre-migration legacy,
    // backfill writes).
    if let Some(p) = pool.as_ref() {
        regression::spawn_sweeper(p.clone());
        tracing::info!("regression sweeper spawned (5m interval)");
    }

    // Phase 27 sub-B: alert rule evaluator. Every 60s scans
    // event_count + crash_free_drop rules; on-event triggers fire
    // synchronously from the ingest path.
    if let Some(p) = pool.as_ref() {
        rule_eval::spawn_cron(p.clone(), notifier_tx.clone());
        tracing::info!("alert rule cron spawned (60s interval)");
    }

    // Phase 27 sub-E: digest evaluator. Hourly, ships opt-in
    // summary emails for daily / weekly subscribers.
    if let Some(p) = pool.as_ref() {
        digest::spawn_cron(p.clone(), notifier_tx.clone());
        tracing::info!("digest cron spawned (1h interval)");
    }

    // v0.8.4: cert-transparency monitor. Every 10m polls crt.sh for
    // each watched domain; new observations land in cert_observations
    // and fan out a notification email to the project's recipient
    // list. Only spawn when both the db and the notifier are wired.
    if let (Some(p), Some(tx)) = (pool.as_ref(), notifier_tx.as_ref()) {
        sentori_server::cert_monitor::spawn(p.clone(), tx.clone());
        tracing::info!("cert-monitor spawned (10m interval)");
    }

    // v0.9.0 #5: issue velocity alerter. Every 5m compares each issue's
    // 30m count vs the prior 30m bucket; trips on ratio ≥ 3 with ≥ 20
    // events absolute. Dedupes via velocity_state table.
    if let (Some(p), Some(tx)) = (pool.as_ref(), notifier_tx.as_ref()) {
        sentori_server::velocity::spawn_cron(p.clone(), tx.clone());
        tracing::info!("velocity cron spawned (5m interval)");
    }

    // Phase 29 sub-B: webhook persistent retry queue dispatcher.
    // notifier::AlertFired enqueues into webhook_deliveries; this task
    // sweeps pending rows every 30s and applies the retry schedule.
    if let Some(p) = pool.as_ref() {
        webhook_dispatch::spawn_cron(p.clone());
        tracing::info!("webhook dispatch cron spawned (30s interval)");
    }

    let addr: SocketAddr = "0.0.0.0:8080".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, "sentori-server listening");

    let base_url = std::env::var("SENTORI_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8080".to_string());

    let metrics_handle = metrics::install();
    tracing::info!("prometheus metrics installed; /metrics is live");

    // Phase 37 sub-A: self-trace emitter. Only enable when both a DB
    // pool is available and the operator has nominated a target
    // project via SENTORI_SELF_TRACE_PROJECT_ID. Skipping silently is
    // the right posture for self-hosted single-tenant setups that
    // don't want self-tracing noise.
    let self_trace =
        match (pool.as_ref(), std::env::var("SENTORI_SELF_TRACE_PROJECT_ID").ok()) {
            (Some(p), Some(id_str)) => match uuid::Uuid::parse_str(&id_str) {
                Ok(id) => {
                    tracing::info!(%id, "self-trace emitter armed");
                    Some(trace_emit::SpanEmitter::spawn(p.clone(), id))
                }
                Err(_) => {
                    tracing::warn!(
                        value = %id_str,
                        "SENTORI_SELF_TRACE_PROJECT_ID not a UUID; self-trace disabled",
                    );
                    None
                }
            },
            _ => None,
        };

    // v0.8.0-d — GeoIP db. The docker image bundles DB-IP Lite at
    // `/app/data/geo.mmdb` (Dockerfile.server fetches at build time),
    // so the default works out of the box with no operator config.
    // `SENTORI_GEOIP_DB_PATH` overrides — point at GeoLite2 City for
    // region + city precision, or unset to disable enrichment for
    // tests. Missing / unreadable file is non-fatal; server runs
    // without enrichment and logs a warning at startup.
    let geoip_db_path = match std::env::var("SENTORI_GEOIP_DB_PATH") {
        Ok(s) if !s.is_empty() => Some(std::path::PathBuf::from(s)),
        _ => {
            let default = std::path::PathBuf::from("/app/data/geo.mmdb");
            if default.exists() {
                Some(default)
            } else {
                None
            }
        }
    };

    let app = router::build(router::ServerConfig {
        dev_token: token,
        db: pool,
        valkey,
        project_id: seed::DEV_PROJECT_ID,
        rate_limit_per_min,
        admin_password,
        session_secret,
        notifier_tx,
        base_url,
        metrics: Some(metrics_handle),
        self_trace,
        attachments: Some(sentori_server::attachments::build_default_store()),
        geoip_db_path,
    });
    // v0.8.0-d — pass the connecting peer's SocketAddr through to
    // handlers so `ConnectInfo<SocketAddr>` extractors (geoip lookup,
    // future audit log) get a real address instead of an `Extension`
    // missing error.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;

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
