// Phase 18 sub-F: invite carries an optional team binding; accepting
// an invite with team_id atomically inserts both org and team
// memberships.

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
        dev_token: "st_pk_invteam0000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "invteam".to_string(),
        session_secret: "invteam-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> (Uuid, String) {
    let _ = reqwest::Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-invteam-1234" }))
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
    reqwest::Client::new()
        .get(format!("http://{addr}/api/auth/verify?token={token}"))
        .send()
        .await
        .unwrap();
    let login = reqwest::Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": "pw-invteam-1234" }))
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
async fn invite_with_team_attaches_user_to_team() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let owner_email = format!("inv-owner-{suffix}@golia.test");
    let invitee_email = format!("inv-target-{suffix}@golia.test");
    let org_slug = format!("org-iv-{}", &suffix[12..28]);

    let (_owner_id, owner_cookie) = register_user(&addr, &pool, &owner_email).await;
    let (invitee_id, invitee_cookie) = register_user(&addr, &pool, &invitee_email).await;

    // Owner creates org + team.
    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": "alpha", "name": "Alpha" }))
        .send()
        .await
        .unwrap();

    // Bad team slug — server rejects upfront.
    let bad = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", &owner_cookie)
        .json(&json!({
            "email": invitee_email,
            "role": "member",
            "teamSlug": "ghost",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 400, "unknown team slug rejected");

    // Real invite with teamSlug.
    let invite_resp = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", &owner_cookie)
        .json(&json!({
            "email": invitee_email,
            "role": "member",
            "teamSlug": "alpha",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(invite_resp.status(), 201);
    let invite_body: Value = invite_resp.json().await.unwrap();
    let token = invite_body["token"].as_str().unwrap();

    // listInvites surfaces the team slug.
    let list = reqwest::Client::new()
        .get(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();
    let list_body: Value = list.json().await.unwrap();
    let entries = list_body.as_array().unwrap();
    assert!(
        entries.iter().any(|e| e["token"] == token && e["teamSlug"] == "alpha"),
        "list_invites returns teamSlug",
    );

    // Invitee accepts.
    let accept = reqwest::Client::new()
        .post(format!("http://{addr}/api/invites/{token}/accept"))
        .header("cookie", &invitee_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(accept.status(), 200);

    // Both memberships landed atomically.
    let in_org: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships m \
         JOIN orgs o ON o.id = m.org_id \
         WHERE o.slug = $1 AND m.user_id = $2)",
    )
    .bind(&org_slug)
    .bind(invitee_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(in_org, "org membership inserted");

    let in_team: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM team_memberships tm \
         JOIN teams t ON t.id = tm.team_id \
         JOIN orgs o ON o.id = t.org_id \
         WHERE o.slug = $1 AND t.slug = 'alpha' AND tm.user_id = $2)",
    )
    .bind(&org_slug)
    .bind(invitee_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(in_team, "team membership inserted");
}

#[tokio::test]
async fn invite_with_dropped_team_falls_back_to_org_only() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let owner_email = format!("inv-owner2-{suffix}@golia.test");
    let invitee_email = format!("inv-target2-{suffix}@golia.test");
    let org_slug = format!("org-id-{}", &suffix[12..28]);

    let (_owner_id, owner_cookie) = register_user(&addr, &pool, &owner_email).await;
    let (invitee_id, invitee_cookie) = register_user(&addr, &pool, &invitee_email).await;

    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": "tmp", "name": "Tmp" }))
        .send()
        .await
        .unwrap();

    let invite_body: Value = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", &owner_cookie)
        .json(&json!({
            "email": invitee_email,
            "role": "member",
            "teamSlug": "tmp",
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = invite_body["token"].as_str().unwrap();

    // Owner deletes the team while the invite is pending.
    reqwest::Client::new()
        .delete(format!("http://{addr}/api/orgs/{org_slug}/teams/tmp"))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();

    // Accept still succeeds — team_id became NULL via FK ON DELETE SET NULL.
    let accept = reqwest::Client::new()
        .post(format!("http://{addr}/api/invites/{token}/accept"))
        .header("cookie", &invitee_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(accept.status(), 200, "accept tolerates dropped team");

    let in_org: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships m \
         JOIN orgs o ON o.id = m.org_id \
         WHERE o.slug = $1 AND m.user_id = $2)",
    )
    .bind(&org_slug)
    .bind(invitee_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(in_org, "org membership still inserted");
}
