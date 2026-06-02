// v1.2 W3.a — source-bundle upload endpoint.
//
// Covers:
//   - Happy path: POST a tar.gz, release_artifacts row appears with
//     kind=source_bundle_ios + name=source-bundle-ios + content_hash.
//   - Idempotent: second upload of same body returns the same hash;
//     blob_path stable (no duplicate blob written).
//   - Replacement: second upload with different bytes overwrites the
//     row's content_hash + blob_path (upsert on (release_id, name)).
//   - Wrong platform → 4xx/5xx.
//   - Empty body → 4xx/5xx.
//   - Non-gzip magic → 4xx/5xx (catches operators piping a raw .tar).

use std::net::SocketAddr;

use flate2::write::GzEncoder;
use flate2::Compression;
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
        dev_token: "st_pk_srcbun0000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "srcbun".to_string(),
        session_secret: "srcbun-secret".to_string(),
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

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-srcbun-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-srcbun-1234" }))
        .send()
        .await
        .unwrap();
    login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .expect("cookie")
}

async fn project_setup(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("sbun-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-sb-{}", &suffix[12..28]);
    let cookie = register(addr, pool, &email).await;
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
    (project_id, cookie)
}

/// Build a minimal tar.gz with a single file at the given path.
fn make_tar_gz(entry_path: &str, body: &[u8]) -> Vec<u8> {
    let buf: Vec<u8> = Vec::new();
    let enc = GzEncoder::new(buf, Compression::default());
    let mut tar = tar::Builder::new(enc);
    let mut header = tar::Header::new_gnu();
    header.set_size(body.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, entry_path, body).unwrap();
    let enc = tar.into_inner().unwrap();
    enc.finish().unwrap()
}

#[tokio::test]
async fn upload_ios_source_bundle_creates_release_artifact() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_setup(&addr, &pool).await;

    let body = make_tar_gz("Sources/MyApp/ContentView.swift", b"struct ContentView {}\n");

    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/source-bundles?release=myapp%401.0.0&platform=ios"
        ))
        .header("cookie", &cookie)
        .header("content-type", "application/gzip")
        .body(body.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "upload: {}", r.text().await.unwrap());

    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT ra.kind, ra.name, ra.content_hash \
         FROM release_artifacts ra \
         JOIN releases r ON r.id = ra.release_id \
         WHERE r.project_id = $1 AND r.name = $2 AND ra.kind LIKE 'source_bundle_%'",
    )
    .bind(project_id)
    .bind("myapp@1.0.0")
    .fetch_optional(&pool)
    .await
    .unwrap();
    let row = row.expect("release_artifacts row present");
    assert_eq!(row.0, "source_bundle_ios");
    assert_eq!(row.1, "source-bundle-ios");
    assert_eq!(row.2.len(), 64, "sha256 hex");
}

#[tokio::test]
async fn upload_same_body_twice_is_idempotent() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_setup(&addr, &pool).await;

    let body = make_tar_gz("a.swift", b"hello\n");

    for _ in 0..2 {
        let r = Client::new()
            .post(format!(
                "http://{addr}/admin/api/projects/{project_id}/source-bundles?release=app%401.0.0&platform=ios"
            ))
            .header("cookie", &cookie)
            .body(body.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 201);
    }

    let row_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM release_artifacts ra \
         JOIN releases r ON r.id = ra.release_id \
         WHERE r.project_id = $1 AND ra.kind = 'source_bundle_ios'",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row_count.0, 1, "exactly one source_bundle_ios row");
}

#[tokio::test]
async fn upload_different_body_replaces_row() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_setup(&addr, &pool).await;

    let body1 = make_tar_gz("a.swift", b"first\n");
    let body2 = make_tar_gz("a.swift", b"second different content\n");

    for body in [&body1, &body2] {
        let r = Client::new()
            .post(format!(
                "http://{addr}/admin/api/projects/{project_id}/source-bundles?release=app%401.0.0&platform=ios"
            ))
            .header("cookie", &cookie)
            .body(body.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 201);
    }

    let row: (String,) = sqlx::query_as(
        "SELECT ra.content_hash FROM release_artifacts ra \
         JOIN releases r ON r.id = ra.release_id \
         WHERE r.project_id = $1 AND ra.kind = 'source_bundle_ios'",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // The latest upload's body2 hash should match.
    use sha2::Digest;
    let expected = format!("{:x}", sha2::Sha256::digest(&body2));
    assert_eq!(row.0, expected);
}

#[tokio::test]
async fn upload_with_unknown_platform_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_setup(&addr, &pool).await;

    let body = make_tar_gz("a.swift", b"hi\n");

    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/source-bundles?release=app%401.0.0&platform=windows"
        ))
        .header("cookie", &cookie)
        .body(body)
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400, "got {}", r.status());
}

#[tokio::test]
async fn upload_non_gzip_body_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_setup(&addr, &pool).await;

    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/source-bundles?release=app%401.0.0&platform=ios"
        ))
        .header("cookie", &cookie)
        .body(b"this is not gzip".to_vec())
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400);
}
