// v1.2 W8 — watchers + per-user notifications. End-to-end test:
//
//   - PUT  /projects/.../issues/.../watch    → user becomes watcher
//   - PATCH issues/... (by a *different* user) → notification row appears
//   - GET  /notifications                    → row visible to watcher
//   - POST /notifications/{id}/read          → row read_at populated
//   - actor of the mutation does NOT receive a self-notification
//   - assignment auto-watches the assignee

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
        dev_token: "st_pk_notif0000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "notif".to_string(),
        session_secret: "notif-secret".to_string(),
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

struct UserSession {
    cookie: String,
    user_id: Uuid,
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> UserSession {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-notif-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-notif-1234" }))
        .send()
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .expect("cookie");
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .unwrap();
    UserSession { cookie, user_id }
}

async fn invite_to_org(
    pool: &PgPool,
    org_slug: &str,
    user_id: Uuid,
) {
    // Direct INSERT — the existing org invite flow is e2e but we
    // don't need it; we just need the second user to be a member of
    // the org so they can hit the admin endpoints.
    let org_id: Uuid = sqlx::query_scalar("SELECT id FROM orgs WHERE slug = $1")
        .bind(org_slug)
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'member') \
         ON CONFLICT DO NOTHING",
    )
    .bind(org_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn project_setup(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, UserSession, UserSession) {
    let suffix = Uuid::now_v7().simple().to_string();
    let owner_email = format!("nowner-{}@golia.test", &suffix[12..28]);
    let watcher_email = format!("nwtch-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-nt-{}", &suffix[12..28]);
    let owner = register(addr, pool, &owner_email).await;
    let watcher = register(addr, pool, &watcher_email).await;
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner.cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    invite_to_org(pool, &org_slug, watcher.user_id).await;
    let proj_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &owner.cookie)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap();
    let tok_resp = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &owner.cookie)
        .json(&json!({ "kind": "public", "label": "ingest" }))
        .send()
        .await
        .unwrap();
    let tok: Value = tok_resp.json().await.unwrap();
    let ingest = tok["token"].as_str().unwrap().to_string();
    (project_id, ingest, owner, watcher)
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

async fn seed_issue(addr: &SocketAddr, ingest: &str, owner_cookie: &str, project_id: Uuid, kind: &str) -> Uuid {
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(ingest)
        .json(&event_payload(kind))
        .send()
        .await
        .unwrap();
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues?status=any"))
        .header("cookie", owner_cookie)
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

async fn list_notifs(addr: &SocketAddr, cookie: &str) -> Vec<Value> {
    Client::new()
        .get(format!("http://{addr}/admin/api/notifications"))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn watcher_gets_notification_for_others_mutations() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, owner, watcher) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &owner.cookie, project_id, "Notif1").await;

    // Watcher starts watching.
    let r = Client::new()
        .put(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/watch"
        ))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);

    // Owner (not the watcher) silences the issue.
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &owner.cookie)
        .json(&json!({ "status": "silenced" }))
        .send()
        .await
        .unwrap();

    // Give fan-out's tokio::spawn a tick to land.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let watcher_notifs = list_notifs(&addr, &watcher.cookie).await;
    assert!(
        watcher_notifs.iter().any(|n| n["kind"] == "status_changed" && n["issueId"] == issue_id.to_string()),
        "watcher should have a status_changed notification: {watcher_notifs:?}"
    );

    // Owner is the actor — should NOT receive a self-notification.
    let owner_notifs = list_notifs(&addr, &owner.cookie).await;
    assert!(
        owner_notifs.iter().all(|n| n["kind"] != "status_changed"),
        "owner (actor) should not get self-notification: {owner_notifs:?}"
    );
}

#[tokio::test]
async fn assigning_user_auto_watches_them() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, owner, watcher) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &owner.cookie, project_id, "AutoWatch1").await;

    // Owner assigns the issue to `watcher`. After this the watcher
    // should be auto-watching (the activity_log writes its
    // assignee_changed entry but the actor is owner; the watcher,
    // freshly added, gets the notification.)
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &owner.cookie)
        .json(&json!({ "assigneeUserId": watcher.user_id }))
        .send()
        .await
        .unwrap();

    // Watch status reports watching=true.
    let s: Value = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/watch"
        ))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(s["watching"].as_bool(), Some(true));

    // The assignee_changed mutation fired BEFORE the watcher was
    // added by the same handler, so we don't strictly guarantee the
    // assignee gets that specific notification. But the next mutation
    // by the owner should reach them.
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &owner.cookie)
        .json(&json!({ "priority": "p0" }))
        .send()
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let watcher_notifs = list_notifs(&addr, &watcher.cookie).await;
    assert!(
        watcher_notifs.iter().any(|n| n["kind"] == "priority_changed"),
        "assignee (auto-watcher) should get priority_changed: {watcher_notifs:?}"
    );
}

#[tokio::test]
async fn mark_read_clears_unread_filter() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, owner, watcher) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &owner.cookie, project_id, "MarkRead1").await;

    // Watcher watches; owner mutates.
    Client::new()
        .put(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/watch"
        ))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap();
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &owner.cookie)
        .json(&json!({ "status": "silenced" }))
        .send()
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let notifs = list_notifs(&addr, &watcher.cookie).await;
    assert!(!notifs.is_empty());
    let id = notifs[0]["id"].as_i64().unwrap();

    // Mark single notification read.
    let r = Client::new()
        .post(format!("http://{addr}/admin/api/notifications/{id}/read"))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);

    // Unread filter returns 0 rows.
    let unread: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/notifications?unread=true"))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unread.iter().filter(|n| n["id"].as_i64() == Some(id)).count(), 0);
}

#[tokio::test]
async fn unwatch_removes_subscription() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, owner, watcher) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &owner.cookie, project_id, "Unwatch1").await;

    Client::new()
        .put(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/watch"
        ))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap();
    let r = Client::new()
        .delete(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/watch"
        ))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
    let s: Value = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/watch"
        ))
        .header("cookie", &watcher.cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(s["watching"].as_bool(), Some(false));
}
