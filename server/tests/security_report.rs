// v1.1 chunk S2 — `POST /v1/security:report` + Pin anomaly list.

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
        dev_token: "st_pk_sec00000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "sec".to_string(),
        session_secret: "sec-secret".to_string(),
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
    let email = format!("sec-{salt}@golia.test");
    let org_slug = format!("org-q-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-sec-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-sec-1234" }))
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
        .json(&json!({ "name": "secp" }))
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
async fn security_report_round_trip() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;

    let r = Client::new()
        .post(format!("http://{addr}/v1/security:report"))
        .bearer_auth(&token)
        .json(&json!({
            "kind": "pin.mismatch",
            "serverName": "api.example.com",
            "installId": "install-xyz",
            "userId": "u_demo",
            "release": "app@1.0.0",
            "environment": "prod",
            "ts": "2026-05-16T12:00:00Z",
            "data": {
                "expected": "sha256/AAAA",
                "observed": "sha256/BBBB"
            }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202, "expected 202 accepted");
    let body: Value = r.json().await.unwrap();
    assert!(body["id"].as_str().is_some());

    let (kind, server_name, install_id, data): (String, String, String, Value) = sqlx::query_as(
        "SELECT kind, server_name, install_id, data FROM security_events \
         WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kind, "pin.mismatch");
    assert_eq!(server_name, "api.example.com");
    assert_eq!(install_id, "install-xyz");
    assert_eq!(data["expected"].as_str(), Some("sha256/AAAA"));
    assert_eq!(data["observed"].as_str(), Some("sha256/BBBB"));
}

#[tokio::test]
async fn security_report_geo_columns_present_and_null_without_geoip() {
    // v1.1 audit-closeout A: the handler now runs GeoIP enrichment.
    // Without a configured db (this test boots without one) the
    // columns stay NULL but the bindings must still be in the INSERT
    // — otherwise the path silently regresses to the pre-audit
    // "schema has columns, handler never writes them" state.
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, _cookie) = project_with_token_and_cookie(&addr, &pool).await;

    let r = Client::new()
        .post(format!("http://{addr}/v1/security:report"))
        .bearer_auth(&token)
        .json(&json!({
            "kind": "root.detected",
            "installId": "install-no-geo",
            "data": { "detector": "rootbeer" }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);

    // Row inserted with the new geo columns; values NULL because no
    // GeoIP db is loaded in tests.
    let row: (Option<i32>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT asn, asn_org, country FROM security_events \
         WHERE project_id = $1 AND install_id = 'install-no-geo'",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, None, "asn null without GeoIP db");
    assert_eq!(row.1, None, "asn_org null without GeoIP db");
    assert_eq!(row.2, None, "country null without GeoIP db");
}

#[tokio::test]
async fn pin_anomalies_aggregates_by_server() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, cookie) = project_with_token_and_cookie(&addr, &pool).await;

    // 3 mismatches against api.example.com (2 distinct installs),
    // 1 mismatch against api.other.com (1 install).
    let payloads = [
        ("api.example.com", "install-a"),
        ("api.example.com", "install-a"),
        ("api.example.com", "install-b"),
        ("api.other.com", "install-c"),
    ];
    for (server, install) in payloads.iter() {
        let r = Client::new()
            .post(format!("http://{addr}/v1/security:report"))
            .bearer_auth(&token)
            .json(&json!({
                "kind": "pin.mismatch",
                "serverName": server,
                "installId": install,
                "ts": "2026-05-17T12:00:00Z",
                "data": { "expected": "sha/x", "observed": "sha/y" }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 202);
    }

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/security/pin-anomalies\
             ?since=2026-05-17T00:00:00Z"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 2);
    let top = &rows[0];
    assert_eq!(top["serverName"].as_str(), Some("api.example.com"));
    assert_eq!(top["count"].as_i64(), Some(3));
    assert_eq!(top["installCount"].as_i64(), Some(2));
}
