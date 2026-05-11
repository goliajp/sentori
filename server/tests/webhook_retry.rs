// Phase 29 sub-B: webhook_dispatch retry queue end-to-end.
//
// Each test seeds a minimal user → org → alert_rule fixture, enqueues a
// row into webhook_deliveries, and drives `webhook_dispatch::sweep_once`
// directly (we don't wait for the 30s interval). Between sweeps we
// manually update next_attempt_at = now() to force the row eligible
// again — the real schedule (60s → 24h) would take a day to walk.

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use axum::{
    Router, extract::State, http::StatusCode, response::IntoResponse,
    routing::post,
};
use sentori_server::{db, webhook, webhook_dispatch};
use serde_json::json;
use serial_test::serial;
use sqlx::PgPool;
use sqlx::types::Uuid;
use tokio::net::TcpListener;

async fn make_pool() -> Option<PgPool> {
    let url = match std::env::var("DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skipping (DATABASE_URL not set)");
            return None;
        }
    };
    match db::connect(&url).await {
        Ok(p) => Some(p),
        Err(e) => {
            eprintln!("skipping (db::connect failed: {e})");
            None
        }
    }
}

#[derive(Clone)]
struct MockState {
    calls: Arc<AtomicU32>,
    /// `None` = always 200. `Some(codes)` = the i-th call (0-indexed)
    /// returns `codes[min(i, codes.len()-1)]` (clamped to last).
    codes: Option<Arc<Vec<u16>>>,
}

async fn mock_handler(State(state): State<MockState>) -> impl IntoResponse {
    let i = state.calls.fetch_add(1, Ordering::SeqCst) as usize;
    let code = match &state.codes {
        None => 200,
        Some(codes) => codes[i.min(codes.len() - 1)],
    };
    StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

async fn spawn_mock(codes: Option<Vec<u16>>) -> (SocketAddr, Arc<AtomicU32>) {
    let calls = Arc::new(AtomicU32::new(0));
    let state = MockState {
        calls: calls.clone(),
        codes: codes.map(Arc::new),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new()
        .route("/hook", post(mock_handler))
        .with_state(state);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, calls)
}

/// Seed user → org → alert_rule (no project binding, no channels — the
/// dispatcher doesn't look at the rule beyond its id existing for FK).
async fn seed_rule(pool: &PgPool) -> Uuid {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, email, password_hash) \
         VALUES ($1, $2, 'unused-by-dispatcher')",
    )
    .bind(user_id)
    .bind(format!("wh-retry-{salt}@golia.test"))
    .execute(pool)
    .await
    .unwrap();

    let org_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO orgs (id, slug, name, owner_id) \
         VALUES ($1, $2, 'wh retry test', $3)",
    )
    .bind(org_id)
    .bind(format!("wh-retry-{salt}"))
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();

    let rule_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO alert_rules (id, org_id, name, trigger_kind) \
         VALUES ($1, $2, 'retry test', 'new_issue')",
    )
    .bind(rule_id)
    .bind(org_id)
    .execute(pool)
    .await
    .unwrap();

    rule_id
}

/// Force the row eligible for the next sweep (skip the real-schedule
/// delay).
async fn force_eligible(pool: &PgPool, delivery_id: Uuid) {
    sqlx::query(
        "UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1",
    )
    .bind(delivery_id)
    .execute(pool)
    .await
    .unwrap();
}

#[derive(sqlx::FromRow, Debug)]
struct DeliveryRow {
    attempt: i32,
    status: String,
    last_status: Option<i32>,
}

async fn fetch_row(pool: &PgPool, id: Uuid) -> DeliveryRow {
    sqlx::query_as("SELECT attempt, status, last_status FROM webhook_deliveries WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
#[serial]
async fn retry_succeeds_after_one_failure() {
    let Some(pool) = make_pool().await else {
        return;
    };
    let rule_id = seed_rule(&pool).await;
    // Mock receiver: 503 on the first call, 200 on every subsequent one.
    let (addr, calls) = spawn_mock(Some(vec![503, 200])).await;

    let delivery_id = webhook::enqueue(
        &pool,
        rule_id,
        json!({ "test": "503-then-200" }),
        format!("http://{addr}/hook"),
        "shared-secret".to_string(),
    )
    .await
    .unwrap();

    // Sweep #1: the row is eligible (next_attempt_at = now() at insert
    // time) → first POST returns 503 → row stays pending with
    // attempt=1, next_attempt_at = now() + 60s.
    webhook_dispatch::sweep_once(&pool).await.unwrap();
    let r = fetch_row(&pool, delivery_id).await;
    assert_eq!(r.attempt, 1, "attempt after first failure");
    assert_eq!(r.status, "pending");
    assert_eq!(r.last_status, Some(503));
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // Walk past the 60s delay in DB-time.
    force_eligible(&pool, delivery_id).await;

    // Sweep #2: 200 → delivered.
    webhook_dispatch::sweep_once(&pool).await.unwrap();
    let r = fetch_row(&pool, delivery_id).await;
    assert_eq!(r.attempt, 2, "attempt after success");
    assert_eq!(r.status, "delivered");
    assert_eq!(r.last_status, Some(200));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
#[serial]
async fn retries_give_up_after_six_attempts() {
    let Some(pool) = make_pool().await else {
        return;
    };
    let rule_id = seed_rule(&pool).await;
    // Perpetual 500 — the dispatcher should attempt 6 times then mark
    // the row failed.
    let (addr, calls) = spawn_mock(Some(vec![500])).await;

    let delivery_id = webhook::enqueue(
        &pool,
        rule_id,
        json!({ "test": "perpetual-500" }),
        format!("http://{addr}/hook"),
        "shared-secret".to_string(),
    )
    .await
    .unwrap();

    // Sweeps 1..6: each one finds the row eligible (we force_eligible
    // between sweeps), tries once, fails, increments attempt.
    for n in 1..=6 {
        webhook_dispatch::sweep_once(&pool).await.unwrap();
        let r = fetch_row(&pool, delivery_id).await;
        assert_eq!(r.attempt, n, "attempt={n} after sweep {n}");
        if n < 6 {
            assert_eq!(r.status, "pending", "still pending at sweep {n}");
            force_eligible(&pool, delivery_id).await;
        } else {
            assert_eq!(r.status, "failed", "failed after sweep 6 (cutoff)");
        }
        assert_eq!(r.last_status, Some(500));
    }
    assert_eq!(calls.load(Ordering::SeqCst), 6, "exactly 6 POSTs");

    // Sweep 7: the row is now status='failed' so the partial index
    // skips it — no new POST goes out.
    let calls_before = calls.load(Ordering::SeqCst);
    webhook_dispatch::sweep_once(&pool).await.unwrap();
    let r = fetch_row(&pool, delivery_id).await;
    assert_eq!(r.attempt, 6, "no further increments after failed");
    assert_eq!(r.status, "failed");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        calls_before,
        "7th sweep must not POST again",
    );

}
