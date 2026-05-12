// Phase 19 sub-B: viewer is read-only.
//
// Asserts the canonical viewer matrix: list endpoints 200, all writes
// 403. Uses a single fixture (one org, one viewer + one owner control)
// so the test is fast and the assertions all share context.

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
        dev_token: "st_pk_viewer000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "viewer".to_string(),
        session_secret: "viewer-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
        self_trace: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> (Uuid, String) {
    let _ = Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-viewer-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-viewer-1234" }))
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

#[tokio::test]
async fn viewer_is_read_only_across_endpoints() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        &Uuid::now_v7().simple().to_string()[12..28],
    );
    let owner_email = format!("vw-owner-{suffix}@golia.test");
    let viewer_email = format!("vw-viewer-{suffix}@golia.test");
    let org_slug = format!("org-vw-{}", &Uuid::now_v7().simple().to_string()[12..28]);

    let (_owner_id, owner_c) = register_user(&addr, &pool, &owner_email).await;
    let (_viewer_id, viewer_c) = register_user(&addr, &pool, &viewer_email).await;

    // Owner creates org + invites viewer with role=viewer, viewer accepts.
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner_c)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    let inv = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", &owner_c)
        .json(&json!({ "email": viewer_email, "role": "viewer" }))
        .send()
        .await
        .unwrap();
    assert_eq!(inv.status(), 201, "invite as viewer accepted by VALID_INVITE_ROLES");
    let inv_body: Value = inv.json().await.unwrap();
    let token = inv_body["token"].as_str().unwrap();
    Client::new()
        .post(format!("http://{addr}/api/invites/{token}/accept"))
        .header("cookie", &viewer_c)
        .send()
        .await
        .unwrap();

    // Confirm the role landed in the DB.
    let role: String = sqlx::query_scalar(
        "SELECT m.role FROM memberships m \
         JOIN orgs o ON o.id = m.org_id \
         WHERE o.slug = $1 AND m.user_id = (SELECT id FROM users WHERE email = $2)",
    )
    .bind(&org_slug)
    .bind(&viewer_email)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role, "viewer", "viewer role landed atomically");

    // Owner pre-creates a team + project so viewer has stuff to read.
    Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_c)
        .json(&json!({ "slug": "alpha", "name": "Alpha" }))
        .send()
        .await
        .unwrap();
    let project_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &owner_c)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    let project: Value = project_resp.json().await.unwrap();
    let project_id = project["id"].as_str().unwrap();

    // ── reads — all 200 ─────────────────────────────────────────────────
    for (label, url) in [
        ("listOrgs", "/api/orgs".to_string()),
        ("getOrg", format!("/api/orgs/{org_slug}")),
        ("listMembers", format!("/api/orgs/{org_slug}/members")),
        ("listTeams", format!("/api/orgs/{org_slug}/teams")),
        ("getTeam", format!("/api/orgs/{org_slug}/teams/alpha")),
        (
            "listTokens",
            format!("/admin/api/projects/{project_id}/tokens"),
        ),
    ] {
        let r = Client::new()
            .get(format!("http://{addr}{url}"))
            .header("cookie", &viewer_c)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "viewer read {label}");
    }

    // ── writes — all 403 ────────────────────────────────────────────────
    let cases: [(&str, reqwest::Method, String, Value); 6] = [
        (
            "createTeam",
            reqwest::Method::POST,
            format!("/api/orgs/{org_slug}/teams"),
            json!({ "slug": "newteam", "name": "X" }),
        ),
        (
            "patchTeam",
            reqwest::Method::PATCH,
            format!("/api/orgs/{org_slug}/teams/alpha"),
            json!({ "name": "Renamed" }),
        ),
        (
            "deleteTeam",
            reqwest::Method::DELETE,
            format!("/api/orgs/{org_slug}/teams/alpha"),
            json!({}),
        ),
        (
            "createInvite",
            reqwest::Method::POST,
            format!("/api/orgs/{org_slug}/invites"),
            json!({ "email": "x@golia.test", "role": "member" }),
        ),
        (
            "createToken",
            reqwest::Method::POST,
            format!("/admin/api/projects/{project_id}/tokens"),
            json!({ "kind": "public", "label": "x" }),
        ),
        (
            "createProject",
            reqwest::Method::POST,
            format!("/admin/api/orgs/{org_slug}/projects"),
            json!({ "name": "x" }),
        ),
    ];

    for (label, method, url, body) in cases {
        let r = Client::new()
            .request(method, format!("http://{addr}{url}"))
            .header("cookie", &viewer_c)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 403, "viewer write {label}");
    }

    // Owner can promote/demote: admin → viewer should round-trip via the
    // patchMember endpoint now that VALID_MEMBER_PATCH_ROLES allows
    // "viewer" but not "owner".
    let viewer_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&viewer_email)
        .fetch_one(&pool)
        .await
        .unwrap();
    let r = Client::new()
        .patch(format!(
            "http://{addr}/api/orgs/{org_slug}/members/{viewer_id}"
        ))
        .header("cookie", &owner_c)
        .json(&json!({ "role": "owner" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400, "patch to owner rejected (transfer-only)");

    let r = Client::new()
        .patch(format!(
            "http://{addr}/api/orgs/{org_slug}/members/{viewer_id}"
        ))
        .header("cookie", &owner_c)
        .json(&json!({ "role": "admin" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "viewer → admin ok");
}
