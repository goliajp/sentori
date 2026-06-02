// v1.2 W6 — `muted` issue status.
//
// muted = "soft silence: stays in the active queue, no alerts". The
// distinction from `silenced` (which hides from the active queue) is
// observable in (a) the dashboard tabs (operator-visible) and (b)
// behavior at ingest: only `resolved` auto-flips to `regressed`, so
// muted issues stay muted regardless of new events. This test pins
// both the API contract and the regression-flip non-behavior.

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
        dev_token: "st_pk_muted0000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "muted".to_string(),
        session_secret: "muted-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-muted-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-muted-1234" }))
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
    let email = format!("mtd-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-mt-{}", &suffix[12..28]);
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

fn event_payload(error_type: &str) -> Value {
    json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "javascript",
        "release": "myapp@1.0.0",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17", "model": "X", "locale": "en" },
        "app": { "version": "1.0.0", "build": "1" },
        "tags": {},
        "breadcrumbs": [],
        "error": {
            "type": error_type,
            "message": format!("{error_type} happened"),
            "stack": [{ "function": "f", "file": "x.ts", "line": 1, "inApp": true }]
        }
    })
}

async fn seed_issue(addr: &SocketAddr, ingest: &str, cookie: &str, project_id: Uuid, kind: &str) -> Uuid {
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(ingest)
        .json(&event_payload(kind))
        .send()
        .await
        .unwrap();
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues?status=any"))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id_str = issues
        .iter()
        .find(|i| i["errorType"] == kind)
        .unwrap()["id"]
        .as_str()
        .unwrap();
    Uuid::parse_str(id_str).unwrap()
}

#[tokio::test]
async fn patch_to_muted_succeeds_and_status_sticks() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "MutedSetA").await;

    let r = Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "muted" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let updated: Value = r.json().await.unwrap();
    assert_eq!(updated["status"].as_str().unwrap(), "muted");
}

#[tokio::test]
async fn new_event_on_muted_issue_does_not_flip_to_regressed() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "MutedKeepA").await;

    // Mute the issue.
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "muted" }))
        .send()
        .await
        .unwrap();

    // New event on the same fingerprint.
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&event_payload("MutedKeepA"))
        .send()
        .await
        .unwrap();

    // Still muted, not regressed.
    let detail: Value = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["status"].as_str().unwrap(), "muted");
    // event_count should have advanced — muted doesn't block ingest,
    // only suppresses status transitions and alerts.
    assert!(detail["eventCount"].as_i64().unwrap() >= 2);
}

#[tokio::test]
async fn bulk_mute_action_works() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let a = seed_issue(&addr, &ingest, &cookie, project_id, "BulkMtA1").await;
    let b = seed_issue(&addr, &ingest, &cookie, project_id, "BulkMtA2").await;

    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues:bulk"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "issueIds": [a, b], "action": "mute" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "{}", r.text().await.unwrap());

    for id in [a, b] {
        let detail: Value = Client::new()
            .get(format!(
                "http://{addr}/admin/api/projects/{project_id}/issues/{id}"
            ))
            .header("cookie", &cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(detail["status"].as_str().unwrap(), "muted");
    }
}
