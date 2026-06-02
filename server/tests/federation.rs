// v1.1 chunk S4 — federation link ingest + cross-project lookup.
//
// Coverage gap: `api/federation.rs` shipped at 0% line coverage in the
// initial S4 PR (only the SDK side had a unit test). These integration
// tests close the gap end-to-end:
//   - POST /v1/security/link happy path + idempotent re-assert
//   - validation errors return F2 structured envelope
//   - GET /admin/api/orgs/{slug}/federation/{provider}/{subject}
//     returns one row per project that linked the same (provider,
//     subject) pair — proves the cross-project view works.

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
        dev_token: "st_pk_fed00000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "fed".to_string(),
        session_secret: "fed-secret".to_string(),
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

async fn project_with_token_and_cookie(
    addr: &SocketAddr,
    pool: &PgPool,
    suffix: &str,
) -> (Uuid, String, String, String) {
    // uuid_v7's leading 8 hex chars are the timestamp — within the
    // same second they're identical, so cross-run repeats hit the
    // register endpoint's silent uniqueness fallback. Use a slice
    // from the random tail instead.
    let raw = Uuid::now_v7().simple().to_string();
    let salt: String = raw.chars().skip(16).take(12).collect();
    let email = format!("fed-{suffix}-{salt}@golia.test");
    let org_slug = format!("org-f-{suffix}-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-fed-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-fed-1234" }))
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
        .json(&json!({ "name": "fedp" }))
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
    (
        project_id,
        tok["token"].as_str().unwrap().to_string(),
        cookie,
        org_slug,
    )
}

#[tokio::test]
async fn federation_link_round_trip() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, _cookie, _org_slug) =
        project_with_token_and_cookie(&addr, &pool, "rt").await;

    let r = Client::new()
        .post(format!("http://{addr}/v1/security/link"))
        .bearer_auth(&token)
        .json(&json!({
            "provider": "google",
            "subject": "sub-abc-1234567890",
            "userId": "u_demo",
            "installId": "install-xyz"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["ok"], json!(true));

    let (provider, subject, user_id, install_id): (String, String, String, String) =
        sqlx::query_as(
            "SELECT provider, subject, user_id, install_id \
             FROM user_federation_links WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(provider, "google");
    assert_eq!(subject, "sub-abc-1234567890");
    assert_eq!(user_id, "u_demo");
    assert_eq!(install_id, "install-xyz");
}

#[tokio::test]
async fn federation_link_idempotent_upsert_updates_user_install() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, _cookie, _org_slug) =
        project_with_token_and_cookie(&addr, &pool, "idem").await;

    // First link
    let r1 = Client::new()
        .post(format!("http://{addr}/v1/security/link"))
        .bearer_auth(&token)
        .json(&json!({
            "provider": "google",
            "subject": "sub-same",
            "userId": "u_old",
            "installId": "install-old"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r1.status(), 202);

    // Re-assert with new user / install — should upsert, not duplicate
    let r2 = Client::new()
        .post(format!("http://{addr}/v1/security/link"))
        .bearer_auth(&token)
        .json(&json!({
            "provider": "google",
            "subject": "sub-same",
            "userId": "u_new",
            "installId": "install-new"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r2.status(), 202);

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_federation_links \
         WHERE project_id = $1 AND provider = 'google' AND subject = 'sub-same'",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "re-assert should upsert, not insert another row");

    let (user_id, install_id): (String, String) = sqlx::query_as(
        "SELECT user_id, install_id FROM user_federation_links \
         WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(user_id, "u_new", "user_id should be updated by ON CONFLICT");
    assert_eq!(install_id, "install-new", "install_id should be updated");
}

#[tokio::test]
async fn federation_link_validation_returns_f2_envelope() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // Empty subject → validator rejects.
    let r = Client::new()
        .post(format!("http://{addr}/v1/security/link"))
        .bearer_auth("st_pk_fed00000000000000000000000")
        .json(&json!({ "provider": "google", "subject": "" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    assert!(r.headers().contains_key("x-sentori-correlation-id"));
    let body: Value = r.json().await.unwrap();
    assert_eq!(
        body["error"]["code"].as_str(),
        Some("federation.invalidLink")
    );
}

#[tokio::test]
async fn federation_lookup_returns_cross_project_rows() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // Same user / org, two projects. Both link the same (provider,
    // subject) and the org lookup endpoint should return both rows.
    let (project_a, token_a, cookie, org_slug) =
        project_with_token_and_cookie(&addr, &pool, "xp").await;

    // Create a second project under the same org via the same cookie.
    let proj_b = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &cookie)
        .json(&json!({ "name": "fedp2" }))
        .send()
        .await
        .unwrap();
    let proj_b_body: Value = proj_b.json().await.unwrap();
    let project_b = Uuid::parse_str(proj_b_body["id"].as_str().unwrap()).unwrap();
    let tok_b = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_b}/tokens"))
        .header("cookie", &cookie)
        .json(&json!({ "kind": "public", "label": "ingest" }))
        .send()
        .await
        .unwrap();
    let tok_b_body: Value = tok_b.json().await.unwrap();
    let token_b = tok_b_body["token"].as_str().unwrap().to_string();

    let subject = format!("shared-sub-{}", Uuid::now_v7());

    for (proj, tok) in &[
        (project_a, token_a.as_str()),
        (project_b, token_b.as_str()),
    ] {
        let r = Client::new()
            .post(format!("http://{addr}/v1/security/link"))
            .bearer_auth(*tok)
            .json(&json!({
                "provider": "google",
                "subject": &subject,
                "userId": format!("u_in_proj_{proj}"),
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 202);
    }

    let r = Client::new()
        .get(format!(
            "http://{addr}/api/orgs/{org_slug}/federation/google/{subject}"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 2);
    let ids: Vec<String> = rows
        .iter()
        .map(|r| r["projectId"].as_str().unwrap().to_string())
        .collect();
    assert!(ids.contains(&project_a.to_string()));
    assert!(ids.contains(&project_b.to_string()));
}
