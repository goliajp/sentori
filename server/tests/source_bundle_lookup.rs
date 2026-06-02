// v1.2 W3.b — end-to-end native source lookup via /source endpoint.
//
// 1. Operator uploads a source bundle for a release.
// 2. Event lands with a native frame whose file = "Sources/Foo.swift",
//    line = 3, no sourcemap involved.
// 3. Dashboard calls /admin/api/projects/<id>/events/<eid>/source.
// 4. Server's source_for_frame returns None (no sourcemap), then
//    falls through to source_bundle::lookup which finds the file and
//    returns ±N lines.

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
        dev_token: "st_pk_sblook0000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "sblook".to_string(),
        session_secret: "sblook-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-sblook-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-sblook-1234" }))
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

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("sblook-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-sl-{}", &suffix[12..28]);
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
    let tok_resp = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &cookie)
        .json(&json!({ "kind": "public", "label": "ingest" }))
        .send()
        .await
        .unwrap();
    let tok: Value = tok_resp.json().await.unwrap();
    let ingest = tok["token"].as_str().unwrap().to_string();
    (project_id, ingest, cookie)
}

fn make_tar_gz(entries: &[(&str, &str)]) -> Vec<u8> {
    let buf: Vec<u8> = Vec::new();
    let enc = GzEncoder::new(buf, Compression::default());
    let mut tar = tar::Builder::new(enc);
    for (path, body) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, path, body.as_bytes()).unwrap();
    }
    let enc = tar.into_inner().unwrap();
    enc.finish().unwrap()
}

#[tokio::test]
async fn native_source_returned_from_uploaded_bundle() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let release = "nativeapp@1.2.3";

    // 1. Upload a source bundle for the iOS platform.
    let swift_body = "// header\nstruct View {\n    func body() {}\n}\n// trailer\n";
    let bundle = make_tar_gz(&[("Sources/MyApp/View.swift", swift_body)]);
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/source-bundles?release={}&platform=ios",
            urlencoding::encode(release)
        ))
        .header("cookie", &cookie)
        .body(bundle)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "bundle upload: {}", r.text().await.unwrap());

    // 2. Ingest an event with a native-style frame.
    let event = json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "ios",
        "release": release,
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17", "model": "iPhone", "locale": "en" },
        "app": { "version": "1.2.3", "build": "1" },
        "tags": {},
        "breadcrumbs": [],
        "error": {
            "type": "NSException",
            "message": "boom",
            "stack": [
                {
                    "function": "body",
                    // Build-machine absolute path; lookup will suffix-match.
                    "file": "/Users/ci/work/agent/myapp/Sources/MyApp/View.swift",
                    "line": 3,
                    "inApp": true
                }
            ]
        }
    });
    let r = Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&event)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202, "ingest: {}", r.text().await.unwrap());

    // Find the event id back via the issues feed.
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues?status=any"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let issue_id = issues[0]["id"].as_str().unwrap();
    let events: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/events"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let event_id = events[0]["id"].as_str().unwrap();

    // 3. Hit /source — expect 200 with the file's body around line 3.
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/events/{event_id}/source?frame=0&lines=2"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "source: {}", r.text().await.unwrap());
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["file"].as_str().unwrap(), "Sources/MyApp/View.swift");
    assert_eq!(body["line"].as_u64().unwrap(), 3);
    assert_eq!(body["at"].as_str().unwrap(), "    func body() {}");
    let before: Vec<&str> = body["before"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(before.iter().any(|s| s.contains("struct View")));
}

#[tokio::test]
async fn native_frame_without_uploaded_bundle_returns_404() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let release = "nobundle@0.1.0";

    // No bundle upload — just ingest the event.
    let event = json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "ios",
        "release": release,
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17", "model": "iPhone", "locale": "en" },
        "app": { "version": "0.1.0", "build": "1" },
        "tags": {},
        "breadcrumbs": [],
        "error": {
            "type": "NSException",
            "message": "boom",
            "stack": [
                {
                    "function": "f",
                    "file": "ContentView.swift",
                    "line": 1,
                    "inApp": true
                }
            ]
        }
    });
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&event)
        .send()
        .await
        .unwrap();
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues?status=any"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let issue_id = issues[0]["id"].as_str().unwrap();
    let events: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/events"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let event_id = events[0]["id"].as_str().unwrap();

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/events/{event_id}/source?frame=0&lines=2"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    // No sourcemap, no bundle → 404 (dashboard renders the "no source"
    // hint).
    assert_eq!(r.status(), 404);
}
