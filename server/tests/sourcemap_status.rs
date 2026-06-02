// v1.2 W2: sourcemap-status endpoint. The dashboard's issue-detail
// banner reads this to decide whether to nudge the operator about
// missing uploads. Three cases the response must distinguish:
//   - project with 0 releases at all
//   - project with releases but 0 sourcemaps
//   - project with at least one sourcemap uploaded

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{json, Value};
use sqlx::{types::Uuid, PgPool};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_smstat0000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "smstat".to_string(),
        session_secret: "smstat-secret".to_string(),
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

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-smstat-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-smstat-1234" }))
        .send()
        .await
        .unwrap();
    login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .expect("session cookie")
}

async fn make_project(addr: &SocketAddr, cookie: &str, org_slug: &str) -> Uuid {
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    let proj_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", cookie)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap()
}

async fn fetch_status(addr: &SocketAddr, cookie: &str, project_id: Uuid) -> Value {
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/sourcemap-status"
        ))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    r.json().await.unwrap()
}

#[tokio::test]
async fn sourcemap_status_distinguishes_three_cases() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("smstat-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-sm-{}", &suffix[12..28]);
    let cookie = register_user(&addr, &pool, &email).await;
    let project_id = make_project(&addr, &cookie, &org_slug).await;

    // Case 1: brand-new project, no releases at all.
    let s = fetch_status(&addr, &cookie, project_id).await;
    assert_eq!(s["releasesTotal"].as_i64().unwrap(), 0);
    assert_eq!(s["releasesWithSourcemap"].as_i64().unwrap(), 0);
    assert!(s["lastUploadedAt"].is_null());

    // Case 2: release exists but no sourcemap uploaded for it.
    let release_id = Uuid::now_v7();
    sqlx::query("INSERT INTO releases (id, project_id, name, created_at) VALUES ($1, $2, $3, now())")
        .bind(release_id)
        .bind(project_id)
        .bind("myapp@1.0.0")
        .execute(&pool)
        .await
        .unwrap();

    let s = fetch_status(&addr, &cookie, project_id).await;
    assert_eq!(s["releasesTotal"].as_i64().unwrap(), 1);
    assert_eq!(s["releasesWithSourcemap"].as_i64().unwrap(), 0);
    assert!(s["lastUploadedAt"].is_null());

    // Case 3: sourcemap uploaded for the release.
    sqlx::query(
        "INSERT INTO release_artifacts \
         (id, release_id, kind, name, content_hash, blob_path) \
         VALUES ($1, $2, 'sourcemap', 'bundle.js.map', 'deadbeef', '/tmp/x')",
    )
    .bind(Uuid::now_v7())
    .bind(release_id)
    .execute(&pool)
    .await
    .unwrap();

    let s = fetch_status(&addr, &cookie, project_id).await;
    assert_eq!(s["releasesTotal"].as_i64().unwrap(), 1);
    assert_eq!(s["releasesWithSourcemap"].as_i64().unwrap(), 1);
    assert!(
        !s["lastUploadedAt"].is_null(),
        "lastUploadedAt should populate once a sourcemap exists: {s}"
    );
    // v1.2 W3.c — native bundle fields default to 0 when not uploaded.
    assert_eq!(s["releasesWithIosBundle"].as_i64().unwrap(), 0);
    assert_eq!(s["releasesWithAndroidBundle"].as_i64().unwrap(), 0);

    // Case 4: insert a source_bundle_ios artifact, status should
    // report releasesWithIosBundle = 1.
    sqlx::query(
        "INSERT INTO release_artifacts \
         (id, release_id, kind, name, content_hash, blob_path) \
         VALUES ($1, $2, 'source_bundle_ios', 'source-bundle-ios', 'feedface', '/tmp/x')",
    )
    .bind(Uuid::now_v7())
    .bind(release_id)
    .execute(&pool)
    .await
    .unwrap();

    let s = fetch_status(&addr, &cookie, project_id).await;
    assert_eq!(s["releasesWithIosBundle"].as_i64().unwrap(), 1);
    assert_eq!(s["releasesWithAndroidBundle"].as_i64().unwrap(), 0);
}
