// Phase 18 sub-C integration tests:
//   - ownership transfer (happy path / non-owner caller / non-eligible target /
//     replay / expired / role swap effects)
//   - audit log listing (admin can read, member cannot, filter works)
//
// Skips cleanly when DATABASE_URL isn't set.

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
        dev_token: "st_pk_xfertest00000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "xfertest".to_string(),
        session_secret: "xfertest-secret".to_string(),
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
    let _ = reqwest::Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-xfer-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-xfer-1234" }))
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
        .expect("session cookie set");

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

async fn invite_and_accept(
    addr: &SocketAddr,
    inviter_cookie: &str,
    org_slug: &str,
    invitee_email: &str,
    invitee_cookie: &str,
    role: &str,
) {
    let invite = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
        .header("cookie", inviter_cookie)
        .json(&json!({ "email": invitee_email, "role": role }))
        .send()
        .await
        .unwrap();
    assert_eq!(invite.status(), 201);
    let body: Value = invite.json().await.unwrap();
    let token = body["token"].as_str().unwrap();
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/invites/{token}/accept"))
        .header("cookie", invitee_cookie)
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success());
}

#[tokio::test]
async fn ownership_transfer_happy_path() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = format!("{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let owner_email = format!("xfer-owner-{suffix}@golia.test");
    let admin_email = format!("xfer-admin-{suffix}@golia.test");
    let org_slug = format!("org-xh-{}", &suffix[12..28]);

    let (owner_id, owner_cookie) = register_user(&addr, &pool, &owner_email).await;
    let (admin_id, admin_cookie) = register_user(&addr, &pool, &admin_email).await;

    create_org(&addr, &owner_cookie, &org_slug).await;
    invite_and_accept(&addr, &owner_cookie, &org_slug, &admin_email, &admin_cookie, "admin").await;

    // Initiate transfer.
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/transfer"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "toUserId": admin_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);

    let token: String = sqlx::query_scalar(
        "SELECT token FROM org_ownership_transfers \
         WHERE to_user_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Old owner can't accept (they're not the to_user).
    let wrong = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/transfers/{token}/accept"))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 403);

    // Target accepts.
    let ok = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/transfers/{token}/accept"))
        .header("cookie", &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);

    // Roles swapped.
    let owner_role: String = sqlx::query_scalar(
        "SELECT role FROM memberships m \
         JOIN orgs o ON o.id = m.org_id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(&org_slug)
    .bind(owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let admin_role: String = sqlx::query_scalar(
        "SELECT role FROM memberships m \
         JOIN orgs o ON o.id = m.org_id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(&org_slug)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner_role, "admin", "old owner demoted to admin");
    assert_eq!(admin_role, "owner", "new owner promoted");

    // Replay refused.
    let replay = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/transfers/{token}/accept"))
        .header("cookie", &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(replay.status(), 400);
}

#[tokio::test]
async fn ownership_transfer_rejects_non_eligible_target() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = format!("{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let owner_email = format!("xfer-owner2-{suffix}@golia.test");
    let member_email = format!("xfer-member-{suffix}@golia.test");
    let outsider_email = format!("xfer-outsider-{suffix}@golia.test");
    let org_slug = format!("org-xn-{}", &suffix[12..28]);

    let (_owner_id, owner_cookie) = register_user(&addr, &pool, &owner_email).await;
    let (member_id, member_cookie) = register_user(&addr, &pool, &member_email).await;
    let (outsider_id, _outsider_cookie) = register_user(&addr, &pool, &outsider_email).await;

    create_org(&addr, &owner_cookie, &org_slug).await;
    invite_and_accept(&addr, &owner_cookie, &org_slug, &member_email, &member_cookie, "member").await;

    // Plain member is not eligible (must be admin/owner first).
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/transfer"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "toUserId": member_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400, "plain member not eligible");

    // Outsider isn't even in the org.
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/transfer"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "toUserId": outsider_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400, "outsider rejected");

    // Non-owner cannot initiate transfer.
    let r = reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/transfer"))
        .header("cookie", &member_cookie)
        .json(&json!({ "toUserId": member_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
}

#[tokio::test]
async fn audit_log_records_team_actions() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = format!("{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let owner_email = format!("audit-owner-{suffix}@golia.test");
    let member_email = format!("audit-member-{suffix}@golia.test");
    let org_slug = format!("org-au-{}", &suffix[12..28]);

    let (_owner_id, owner_cookie) = register_user(&addr, &pool, &owner_email).await;
    let (_member_id, member_cookie) = register_user(&addr, &pool, &member_email).await;

    create_org(&addr, &owner_cookie, &org_slug).await;
    invite_and_accept(&addr, &owner_cookie, &org_slug, &member_email, &member_cookie, "member").await;

    // Owner creates a team — should land in audit_logs.
    reqwest::Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": "auditteam", "name": "Audit Team" }))
        .send()
        .await
        .unwrap();

    // Owner reads audit log.
    let r = reqwest::Client::new()
        .get(format!("http://{addr}/api/orgs/{org_slug}/audit"))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    let entries = body.as_array().unwrap();
    assert!(entries.len() >= 2, "expect org.created + team.created");
    let actions: Vec<&str> = entries
        .iter()
        .map(|e| e["action"].as_str().unwrap())
        .collect();
    assert!(actions.contains(&"team.created"), "team.created present: {actions:?}");
    assert!(actions.contains(&"org.created"), "org.created present: {actions:?}");

    // Plain member is denied audit access.
    let r = reqwest::Client::new()
        .get(format!("http://{addr}/api/orgs/{org_slug}/audit"))
        .header("cookie", &member_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403, "plain member cannot read audit");

    // Filter by action.
    let r = reqwest::Client::new()
        .get(format!("http://{addr}/api/orgs/{org_slug}/audit?action=team.created"))
        .header("cookie", &owner_cookie)
        .send()
        .await
        .unwrap();
    let body: Value = r.json().await.unwrap();
    let filtered = body.as_array().unwrap();
    assert!(!filtered.is_empty());
    for e in filtered {
        assert_eq!(e["action"].as_str().unwrap(), "team.created");
    }
}
