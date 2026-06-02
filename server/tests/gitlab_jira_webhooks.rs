// v1.2 W7.c + W7.d — GitLab + Jira Cloud inbound webhook smoke tests.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{json, Value};
use sqlx::{types::Uuid, PgPool};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    unsafe {
        std::env::set_var("SENTORI_GITLAB_WEBHOOK_SECRET", "gl-test-secret");
        std::env::set_var("SENTORI_JIRA_WEBHOOK_SECRET", "jira-test-secret");
    }
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_gljr00000000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "gljr".to_string(),
        session_secret: "gljr-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-gljr-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-gljr-1234" }))
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

async fn project_setup(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("gljr-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-gj-{}", &suffix[12..28]);
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

fn event_payload(kind: &str) -> Value {
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
            "type": kind,
            "message": format!("{kind} happened"),
            "stack": [{ "function": "f", "file": "x.ts", "line": 1, "inApp": true }]
        }
    })
}

async fn seed_issue(addr: &SocketAddr, ingest: &str, cookie: &str, project_id: Uuid) -> Uuid {
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(ingest)
        .json(&event_payload("GljrErr"))
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
    Uuid::parse_str(issues[0]["id"].as_str().unwrap()).unwrap()
}

async fn fetch_links(addr: &SocketAddr, cookie: &str, project_id: Uuid, issue_id: Uuid) -> Vec<Value> {
    Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/integration-links"
        ))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn gitlab_webhook_refreshes_metadata_and_syncs_status() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id).await;
    let external_id = "myteam/myapp#7";

    sqlx::query(
        "INSERT INTO issue_integration_links \
            (issue_id, integration_kind, external_id, external_url) \
         VALUES ($1, 'gitlab', $2, $3)",
    )
    .bind(issue_id)
    .bind(external_id)
    .bind("https://gitlab.com/myteam/myapp/-/issues/7")
    .execute(&pool)
    .await
    .unwrap();

    let body = json!({
        "object_kind": "issue",
        "object_attributes": {
            "iid": 7,
            "title": "Login crash",
            "state": "closed",
            "action": "close"
        },
        "project": { "path_with_namespace": "myteam/myapp" }
    });
    let r = Client::new()
        .post(format!("http://{addr}/v1/integrations/gitlab/webhook"))
        .header("x-gitlab-token", "gl-test-secret")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "{}", r.text().await.unwrap());

    let links = fetch_links(&addr, &cookie, project_id, issue_id).await;
    let link = &links[0];
    assert_eq!(link["externalTitle"].as_str().unwrap(), "Login crash");
    assert_eq!(link["externalStatus"].as_str().unwrap(), "closed");
    let issue: Value = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(issue["status"].as_str().unwrap(), "resolved");
}

#[tokio::test]
async fn gitlab_webhook_with_bad_token_returns_401() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let r = Client::new()
        .post(format!("http://{addr}/v1/integrations/gitlab/webhook"))
        .header("x-gitlab-token", "wrong")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}

#[tokio::test]
async fn jira_webhook_refreshes_metadata_and_syncs_status() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id).await;
    let jira_key = "ENG-42";

    sqlx::query(
        "INSERT INTO issue_integration_links \
            (issue_id, integration_kind, external_id, external_url) \
         VALUES ($1, 'jira', $2, $3)",
    )
    .bind(issue_id)
    .bind(jira_key)
    .bind("https://mycompany.atlassian.net/browse/ENG-42")
    .execute(&pool)
    .await
    .unwrap();

    let body = json!({
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": jira_key,
            "fields": {
                "summary": "Login crash repro",
                "status": { "name": "Done" }
            }
        }
    });
    let r = Client::new()
        .post(format!(
            "http://{addr}/v1/integrations/jira/webhook?secret=jira-test-secret"
        ))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "{}", r.text().await.unwrap());

    let links = fetch_links(&addr, &cookie, project_id, issue_id).await;
    let link = &links[0];
    assert_eq!(link["externalTitle"].as_str().unwrap(), "Login crash repro");
    assert_eq!(link["externalStatus"].as_str().unwrap(), "Done");
    let issue: Value = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(issue["status"].as_str().unwrap(), "resolved");
}

#[tokio::test]
async fn jira_webhook_with_bad_secret_returns_401() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let r = Client::new()
        .post(format!(
            "http://{addr}/v1/integrations/jira/webhook?secret=wrong"
        ))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}
