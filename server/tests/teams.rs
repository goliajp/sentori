// Phase 18 sub-B integration tests: team CRUD + project↔team ACL.
//
// All tests skip cleanly when DATABASE_URL isn't set (CI / no-DB envs).
// Each test creates a fresh org with two users so they don't collide.

use std::net::SocketAddr;

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
        dev_token: "st_pk_teamstest0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "teamstest".to_string(),
        session_secret: "teamstest-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });

    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
    });

    Some((addr, pool))
}

/// Register + verify a user; return (user_id, login_cookie).
async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> (Uuid, String) {
    let _ = reqwest::Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-teamstest-1234" }))
        .send()
        .await
        .unwrap();

    // Pull the verify token straight from PG and visit /verify.
    let token: String = sqlx::query_scalar(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id WHERE u.email = $1",
    )
    .bind(email)
    .fetch_one(pool)
    .await
    .unwrap();
    reqwest::Client::new()
        .get(format!("http://{addr}/api/auth/verify?token={token}"))
        .send()
        .await
        .unwrap();

    // Fresh login on a new client so we get a clean cookie string.
    let login = reqwest::Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": "pw-teamstest-1234" }))
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
        .expect("login set sentori_session cookie");

    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .unwrap();

    (user_id, cookie)
}

async fn create_org(addr: &SocketAddr, cookie: &str, slug: &str) -> Uuid {
    let resp = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", cookie)
        .json(&json!({ "slug": slug, "name": slug }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let body: Value = resp.json().await.unwrap();
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_project(addr: &SocketAddr, cookie: &str, org_slug: &str) -> Uuid {
    let resp = reqwest::Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", cookie)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let body: Value = resp.json().await.unwrap();
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn team_admin_can_create_member_cant() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let admin_email = format!("team-admin-{suffix}@golia.test");
    let member_email = format!("team-member-{suffix}@golia.test");
    let org_slug = format!("org-tac-{}", &suffix[12..28]);

    let (_admin_id, admin_cookie) = register_user(&addr, &pool, &admin_email).await;
    let (member_id, member_cookie) = register_user(&addr, &pool, &member_email).await;

    let _org_id = create_org(&addr, &admin_cookie, &org_slug).await;

    // Admin invites member (role=member).
    let invite_resp = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", &admin_cookie)
        .json(&json!({ "email": member_email, "role": "member" }))
        .send()
        .await
        .unwrap();
    assert_eq!(invite_resp.status(), 201);
    let invite_body: Value = invite_resp.json().await.unwrap();
    let invite_token = invite_body["token"].as_str().unwrap();
    reqwest::Client::new()
        .post(format!("http://{addr}/api/invites/{invite_token}/accept"))
        .header("cookie", &member_cookie)
        .send()
        .await
        .unwrap();

    // Owner creates a team.
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &admin_cookie)
        .json(&json!({ "slug": "alpha", "name": "Alpha" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "owner can create team");

    // Member tries to create — 403.
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &member_cookie)
        .json(&json!({ "slug": "beta", "name": "Beta" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403, "plain member cannot create team");

    // Member tries to add themselves to alpha — 403.
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams/alpha/members"))
        .header("cookie", &member_cookie)
        .json(&json!({ "userId": member_id, "role": "member" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
}

#[tokio::test]
async fn team_bound_project_gates_non_team_member() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let owner_email = format!("team-owner-{suffix}@golia.test");
    let in_team_email = format!("in-team-{suffix}@golia.test");
    let out_team_email = format!("out-team-{suffix}@golia.test");
    let org_slug = format!("org-tbp-{}", &suffix[12..28]);

    let (_owner_id, owner_cookie) = register_user(&addr, &pool, &owner_email).await;
    let (in_id, in_cookie) = register_user(&addr, &pool, &in_team_email).await;
    let (_out_id, out_cookie) = register_user(&addr, &pool, &out_team_email).await;

    create_org(&addr, &owner_cookie, &org_slug).await;
    let project_id = create_project(&addr, &owner_cookie, &org_slug).await;

    // Invite both as plain members.
    for email in [&in_team_email, &out_team_email] {
        let invite_resp = reqwest::Client::new()
            .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
            .header("cookie", &owner_cookie)
            .json(&json!({ "email": email, "role": "member" }))
            .send()
            .await
            .unwrap();
        let invite_body: Value = invite_resp.json().await.unwrap();
        let invite_token = invite_body["token"].as_str().unwrap();
        let cookie = if **email == in_team_email { &in_cookie } else { &out_cookie };
        reqwest::Client::new()
            .post(format!("http://{addr}/api/invites/{invite_token}/accept"))
            .header("cookie", cookie)
            .send()
            .await
            .unwrap();
    }

    // Owner creates team alpha and adds in_id.
    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": "alpha", "name": "Alpha" }))
        .send()
        .await
        .unwrap();
    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams/alpha/members"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "userId": in_id, "role": "member" }))
        .send()
        .await
        .unwrap();

    // Before binding: both members can list the project's tokens.
    for cookie in [&in_cookie, &out_cookie] {
        let r = reqwest::Client::new()
            .get(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
            .header("cookie", cookie)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "no team binding yet → all members allowed");
    }

    // Bind project to alpha (owner).
    let r = reqwest::Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/teams/alpha"
        ))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);

    // After binding: in_team member still 200, out_team member 403, owner still 200.
    let in_r = reqwest::Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &in_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(in_r.status(), 200, "team member allowed");

    let out_r = reqwest::Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &out_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(out_r.status(), 403, "non-team member blocked");

    let owner_r = reqwest::Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(owner_r.status(), 200, "org owner bypasses team gate");
}
