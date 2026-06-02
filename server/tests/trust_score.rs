// v1.1 chunk S3 — trust score computation + admin list.

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
        dev_token: "st_pk_trust0000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "trust".to_string(),
        session_secret: "trust-secret".to_string(),
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

async fn project_with_token_and_cookie(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("trust-{salt}@golia.test");
    let org_slug = format!("org-t-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-trust-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-trust-1234" }))
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
        .json(&json!({ "name": "trustp" }))
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
    (project_id, tok["token"].as_str().unwrap().to_string(), cookie)
}

#[tokio::test]
async fn trust_score_subtracts_weight_per_kind() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;

    // Seed: 1 pin.mismatch (weight 30) + 1 root.detected (weight 50)
    // for install-aaa within the 24h window → expected score 100-80 = 20.
    let now = time::OffsetDateTime::now_utc();
    let recent = now - time::Duration::hours(2);
    for kind in &["pin.mismatch", "root.detected"] {
        sqlx::query(
            "INSERT INTO security_events
                 (id, project_id, kind, install_id, data, occurred_at)
             VALUES ($1, $2, $3, 'install-aaa', '{}'::jsonb, $4)",
        )
        .bind(Uuid::now_v7())
        .bind(project_id)
        .bind(kind)
        .bind(recent)
        .execute(&pool)
        .await
        .unwrap();
    }

    let r = Client::new()
        .get(format!(
            "http://{addr}/v1/security/score?installId=install-aaa"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["installId"].as_str(), Some("install-aaa"));
    assert_eq!(body["score"].as_i64(), Some(20));
    let signals = body["signals"].as_array().unwrap();
    assert_eq!(signals.len(), 2);
}

#[tokio::test]
async fn trust_score_baseline_for_clean_install() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_pid, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;
    let r = Client::new()
        .get(format!(
            "http://{addr}/v1/security/score?installId=install-zzz"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["score"].as_i64(), Some(100));
}

#[tokio::test]
async fn trust_score_missing_installid_returns_structured_400() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_pid, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;
    let r = Client::new()
        .get(format!("http://{addr}/v1/security/score"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    let body: Value = r.json().await.unwrap();
    assert_eq!(
        body["error"]["code"].as_str(),
        Some("trust.missingInstallId")
    );
}

#[tokio::test]
async fn list_low_scores_sorts_ascending() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, _token, cookie) = project_with_token_and_cookie(&addr, &pool).await;

    // install-bad: 2 × root.detected → 100 - 100 = 0
    // install-mid: 1 × pin.mismatch → 100 - 30 = 70
    let recent = time::OffsetDateTime::now_utc() - time::Duration::hours(1);
    for (install, kind, n) in &[("install-bad", "root.detected", 2), ("install-mid", "pin.mismatch", 1)] {
        for _ in 0..*n {
            sqlx::query(
                "INSERT INTO security_events
                     (id, project_id, kind, install_id, data, occurred_at)
                 VALUES ($1, $2, $3, $4, '{}'::jsonb, $5)",
            )
            .bind(Uuid::now_v7())
            .bind(project_id)
            .bind(kind)
            .bind(install)
            .bind(recent)
            .execute(&pool)
            .await
            .unwrap();
        }
    }

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/trust/scores"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["installId"].as_str(), Some("install-bad"));
    assert_eq!(rows[0]["score"].as_i64(), Some(0));
    assert_eq!(rows[1]["installId"].as_str(), Some("install-mid"));
    assert_eq!(rows[1]["score"].as_i64(), Some(70));
}

#[tokio::test]
async fn trust_score_oversized_install_id_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_pid, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;
    // 65 chars > 64 cap
    let big = "x".repeat(65);
    let r = Client::new()
        .get(format!(
            "http://{addr}/v1/security/score?installId={big}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    let body: Value = r.json().await.unwrap();
    assert_eq!(
        body["error"]["code"].as_str(),
        Some("trust.invalidInstallId")
    );
}

#[tokio::test]
async fn trust_score_stream_endpoint_removed() {
    // v1.1 audit-closeout E: the SSE backplane was pulled. This test
    // asserts the route is genuinely gone so a partial revert can't
    // silently re-introduce the unsustainable poll-per-subscriber.
    // When v1.2 lands LISTEN/NOTIFY-based push the route name might
    // come back but the behaviour must be event-driven, not polled —
    // re-enabling this exact shape needs a conscious test update.
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_pid, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;
    let resp = Client::new()
        .get(format!(
            "http://{addr}/v1/security/score:stream?installId=install-x"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error() || resp.status().is_server_error(),
        "route should be gone (4xx/5xx); got {}",
        resp.status()
    );
}
