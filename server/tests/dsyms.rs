// Phase 22 sub-A integration tests: dSYM upload + listing.
//
// Skips when DATABASE_URL isn't set. Builds a tiny org/project setup
// per case (uuid suffix prevents parallel collisions), then exercises
// the upload happy path, idempotent re-upload, header validation, and
// the cross-org access gate.

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
        dev_token: "st_pk_dsymtest0000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "dsymtest".to_string(),
        session_secret: "dsymtest-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> (Uuid, String) {
    let _ = Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-dsym-1234" }))
        .send()
        .await
        .unwrap();
    let token: String = sqlx::query_scalar(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id WHERE u.email = $1",
    )
    .bind(email)
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
        .json(&json!({ "email": email, "password": "pw-dsym-1234" }))
        .send()
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| {
            let s = v.to_str().ok()?;
            s.split(';').next().map(str::to_string)
        })
        .expect("session cookie");
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .unwrap();
    (user_id, cookie)
}

const FAKE_DEBUG_ID: &str = "1234abcd-1234-1234-1234-1234567890ab";
const FAKE_BODY: &[u8] = b"fake-dsym-bytes\x00\x01\x02\x03";

#[tokio::test]
async fn upload_lists_idempotent() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // First 12 chars of a v7 uuid simple form are pure timestamp — within
    // the same ms parallel tests collide. Slice from [12..28] picks up
    // the random tail so emails / slugs stay unique.
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("dsym-owner-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-ds-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

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
    let project_id = proj["id"].as_str().unwrap();

    // First upload — 201.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms?release=app%401.2.3"
        ))
        .header("cookie", &cookie)
        .header("content-type", "application/octet-stream")
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "arm64")
        .body(FAKE_BODY.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["debugId"].as_str().unwrap(), FAKE_DEBUG_ID);
    assert_eq!(body["arch"].as_str().unwrap(), "arm64");
    assert_eq!(body["sizeBytes"].as_i64().unwrap(), FAKE_BODY.len() as i64);

    // Re-upload same (debug_id, arch) — still 201, ON CONFLICT updates.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms"
        ))
        .header("cookie", &cookie)
        .header("content-type", "application/octet-stream")
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "arm64")
        .body(b"replaced".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);

    // Listing returns one row with the latest size.
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let rows: Vec<Value> = r.json().await.unwrap();
    let alpha = rows.iter().find(|r| r["arch"] == "arm64").unwrap();
    assert_eq!(alpha["sizeBytes"].as_i64().unwrap(), 8); // "replaced".len()
    assert_eq!(alpha["debugId"].as_str().unwrap(), FAKE_DEBUG_ID);
}

#[tokio::test]
async fn upload_rejects_bad_headers() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // First 12 chars of a v7 uuid simple form are pure timestamp — within
    // the same ms parallel tests collide. Slice from [12..28] picks up
    // the random tail so emails / slugs stay unique.
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("dsym-bad-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-db-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

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
    let project_id = proj["id"].as_str().unwrap();

    // Missing debug_id header → 400.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms"
        ))
        .header("cookie", &cookie)
        .header("x-sentori-arch", "arm64")
        .body(FAKE_BODY.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // Unknown arch → 400.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms"
        ))
        .header("cookie", &cookie)
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "powerpc")
        .body(FAKE_BODY.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // Empty body → 400.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms"
        ))
        .header("cookie", &cookie)
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "arm64")
        .body(Vec::<u8>::new())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
}

#[tokio::test]
async fn upload_blocked_for_outsider() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // First 12 chars of a v7 uuid simple form are pure timestamp — within
    // the same ms parallel tests collide. Slice from [12..28] picks up
    // the random tail so emails / slugs stay unique.
    let suffix = Uuid::now_v7().simple().to_string();
    let owner_email = format!("dsym-out-owner-{}@golia.test", &suffix[12..28]);
    let outsider_email = format!("dsym-outsider-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-do-{}", &suffix[12..28]);
    let (_oid, owner_c) = register_user(&addr, &pool, &owner_email).await;
    let (_xid, outsider_c) = register_user(&addr, &pool, &outsider_email).await;

    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner_c)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    let proj_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &owner_c)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = proj["id"].as_str().unwrap();

    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms"
        ))
        .header("cookie", &outsider_c)
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "arm64")
        .body(FAKE_BODY.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        403,
        "non-org-member blocked by require_project_in_org"
    );
}

#[tokio::test]
async fn list_releases_returns_enriched_rows() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("rel-list-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-rl-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

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
    let project_id = proj["id"].as_str().unwrap();
    let project_uuid = Uuid::parse_str(project_id).unwrap();

    // Pre-create two releases by hand (mirroring how the events
    // pipeline would create them) so the JOIN aggregates have rows
    // to enumerate without spinning up event ingestion.
    sqlx::query("INSERT INTO releases (id, project_id, name, deploy_at) VALUES ($1, $2, $3, now())")
        .bind(Uuid::now_v7())
        .bind(project_uuid)
        .bind("alpha@1.0.0")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO releases (id, project_id, name) VALUES ($1, $2, $3)")
        .bind(Uuid::now_v7())
        .bind(project_uuid)
        .bind("beta@1.1.0")
        .execute(&pool)
        .await
        .unwrap();

    // Upload a dSYM tagged for alpha so the count flows through.
    Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms?release=alpha%401.0.0"
        ))
        .header("cookie", &cookie)
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "arm64")
        .body(FAKE_BODY.to_vec())
        .send()
        .await
        .unwrap();

    let r = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/releases"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 2);
    let alpha = rows.iter().find(|r| r["name"] == "alpha@1.0.0").unwrap();
    assert_eq!(alpha["dsymCount"].as_i64().unwrap(), 1);
    assert_eq!(alpha["sourcemapCount"].as_i64().unwrap(), 0);
    let beta = rows.iter().find(|r| r["name"] == "beta@1.1.0").unwrap();
    assert_eq!(beta["dsymCount"].as_i64().unwrap(), 0);
    assert_eq!(beta["eventCount"].as_i64().unwrap(), 0);
    // alpha has explicit deploy_at; beta does not (deployAt null).
    // alpha has explicit deploy_at (non-null); beta does not.
    // Serialization format is left to serde defaults — the dashboard
    // doesn't care about the wire shape, only is-it-set.
    assert!(!alpha["deployAt"].is_null(), "alpha deployAt set: {alpha}");
    assert!(beta["deployAt"].is_null(), "beta deployAt unset: {beta}");
}

#[tokio::test]
async fn release_artifacts_unifies_dsym_and_mapping() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("ds-art-owner-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-da-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

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
    let project_id = proj["id"].as_str().unwrap();

    let release = "myapp@1.2.3+42";
    let release_enc = release.replace('@', "%40").replace('+', "%2B");

    // Upload a dSYM and a mapping for the same release.
    Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/dsyms?release={release_enc}"
        ))
        .header("cookie", &cookie)
        .header("x-sentori-debug-id", FAKE_DEBUG_ID)
        .header("x-sentori-arch", "arm64")
        .body(FAKE_BODY.to_vec())
        .send()
        .await
        .unwrap();
    Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/mappings?release={release_enc}"
        ))
        .header("cookie", &cookie)
        .body(b"# pg_map_id: cafe-babe\nfoo -> a:\n".to_vec())
        .send()
        .await
        .unwrap();

    // Unified summary should return both, plus an empty sourcemaps array.
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/releases/{release_enc}/artifacts"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["release"].as_str().unwrap(), release);
    assert_eq!(body["dsyms"].as_array().unwrap().len(), 1);
    assert_eq!(body["mappings"].as_array().unwrap().len(), 1);
    assert_eq!(body["sourcemaps"].as_array().unwrap().len(), 0);

    // A different release returns empty arrays for everything.
    let other = "other%401.0.0";
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/releases/{other}/artifacts"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["dsyms"].as_array().unwrap().len(), 0);
    assert_eq!(body["mappings"].as_array().unwrap().len(), 0);
    assert_eq!(body["sourcemaps"].as_array().unwrap().len(), 0);
}
