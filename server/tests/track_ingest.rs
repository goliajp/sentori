// v1.1 chunk B — TDD red phase for `POST /v1/track:batch`.
//
// Scenarios:
//   1. Happy batch — 2 events with distinct names, both persist;
//      response is 202 with {accepted, skipped} envelope; route +
//      user_id + props persist as expected.
//   2. Auth — missing token → 401 with structured error body
//      (auth.missingToken from F2). Same shape as /v1/sessions.
//   3. Batch cap — 501 events → 400 track.batchTooLarge.
//   4. $pageview shape — auto-emitted pageview from the SDK must
//      round-trip (sanity that the wire format the SDK ships works
//      end-to-end before we wire navigation.ts to it).
//
// Skips cleanly when DATABASE_URL isn't set so CI without a Postgres
// service stays green.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_track000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "trk".to_string(),
        session_secret: "trk-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Some((addr, pool))
}

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("trk-{salt}@golia.test");
    let org_slug = format!("org-t-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-trk-1234" }))
        .send()
        .await
        .unwrap();
    let token: String = sqlx::query_scalar(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id WHERE u.email = $1",
    )
    .bind(&email)
    .fetch_one(pool)
    .await
    .unwrap();
    Client::new()
        .get(format!("http://{addr}/api/auth/verify?token={token}"))
        .send()
        .await
        .unwrap();
    let login = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": "pw-trk-1234" }))
        .send()
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| {
            v.to_str()
                .ok()
                .and_then(|s| s.split(';').next())
                .map(str::to_string)
        })
        .unwrap();

    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    let proj_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &cookie)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap();
    let tok_resp = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &cookie)
        .json(&json!({ "kind": "public", "label": "ingest" }))
        .send()
        .await
        .unwrap();
    let tok: Value = tok_resp.json().await.unwrap();
    (project_id, tok["token"].as_str().unwrap().to_string())
}

#[tokio::test]
async fn track_batch_round_trip() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token) = project_with_token(&addr, &pool).await;

    let r = Client::new()
        .post(format!("http://{addr}/v1/track:batch"))
        .bearer_auth(&token)
        .json(&json!({
            "events": [
                {
                    "name": "checkout.started",
                    "ts": "2026-05-10T12:00:00Z",
                    "userId": "u_abc",
                    "route": "Checkout",
                    "release": "myapp@1.0.0",
                    "environment": "prod",
                    "props": { "cart_value": 4200, "currency": "JPY" }
                },
                {
                    "name": "$pageview",
                    "ts": "2026-05-10T12:00:01Z",
                    "userId": "u_abc",
                    "route": "Cart",
                    "release": "myapp@1.0.0",
                    "environment": "prod"
                }
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202, "expected 202 accepted");
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["accepted"].as_u64(), Some(2));
    assert_eq!(body["skipped"].as_u64(), Some(0));

    // verify per-name persistence
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM track_events WHERE project_id = $1 AND name IN ('checkout.started', '$pageview')",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 2);

    let (route, user_id, props): (String, String, Value) = sqlx::query_as(
        "SELECT route, user_id, props FROM track_events \
         WHERE project_id = $1 AND name = 'checkout.started'",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(route, "Checkout");
    assert_eq!(user_id, "u_abc");
    assert_eq!(props["cart_value"].as_i64(), Some(4200));
    assert_eq!(props["currency"].as_str(), Some("JPY"));
}

#[tokio::test]
async fn track_missing_auth_returns_structured_401() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let r = Client::new()
        .post(format!("http://{addr}/v1/track:batch"))
        .json(&json!({ "events": [] }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    assert!(r.headers().contains_key("x-sentori-correlation-id"));
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["error"]["code"].as_str(), Some("auth.missingToken"));
}

#[tokio::test]
async fn track_batch_over_cap_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_project_id, token) = project_with_token(&addr, &pool).await;

    let mut events = Vec::with_capacity(501);
    for i in 0..501 {
        events.push(json!({ "name": format!("e{i}"), "ts": "2026-05-10T12:00:00Z" }));
    }
    let r = Client::new()
        .post(format!("http://{addr}/v1/track:batch"))
        .bearer_auth(&token)
        .json(&json!({ "events": events }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["error"]["code"].as_str(), Some("track.batchTooLarge"));
}

#[tokio::test]
async fn track_props_oversized_bytes_skipped() {
    // v1.1 audit-closeout B: per-event props are 40-key max but each
    // value can be arbitrarily large within a 1MB outer body cap. Add
    // a per-event serialised-byte cap so one client can't blow up
    // row size + bloat the JSONB partition.
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token) = project_with_token(&addr, &pool).await;

    // ~30 KB string value — well past any reasonable analytics value.
    let big = "x".repeat(30_000);
    let r = Client::new()
        .post(format!("http://{addr}/v1/track:batch"))
        .bearer_auth(&token)
        .json(&json!({
            "events": [
                { "name": "good", "ts": "2026-05-10T12:00:00Z" },
                {
                    "name": "bad",
                    "ts": "2026-05-10T12:00:00Z",
                    "props": { "blob": big }
                }
            ]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["accepted"].as_u64(), Some(1), "only the small event should land");
    assert_eq!(body["skipped"].as_u64(), Some(1), "the oversized props event should be skipped");

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM track_events WHERE project_id = $1 AND name = 'bad'",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0, "oversized event must not persist");
}
