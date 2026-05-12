// Phase 24 sub-C: saved views CRUD + visibility matrix.
//
// Three users in the same org:
//   owner (org admin), lead (team lead), member (just a member).
// We seed personal/team/org views and verify each caller sees only what
// they should + delete authorization mirrors create authorization.

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
        dev_token: "st_pk_views000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "v".to_string(),
        session_secret: "v-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-views-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-views-1234" }))
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

async fn user_id(pool: &PgPool, email: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn list_view_names(addr: &SocketAddr, slug: &str, cookie: &str) -> Vec<String> {
    let r = Client::new()
        .get(format!("http://{addr}/api/orgs/{slug}/views"))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "list views: {}", r.text().await.unwrap());
    let rows: Vec<Value> = r.json().await.unwrap();
    rows.iter()
        .map(|r| r["name"].as_str().unwrap().to_string())
        .collect::<Vec<_>>()
}

#[tokio::test]
async fn views_visibility_and_authz() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let owner_email = format!("owner-{salt}@golia.test");
    let lead_email = format!("lead-{salt}@golia.test");
    let member_email = format!("member-{salt}@golia.test");
    let bystander_email = format!("bystander-{salt}@golia.test");
    let org_slug = format!("org-v-{salt}");
    let team_slug = "alpha";

    let owner_cookie = register(&addr, &pool, &owner_email).await;
    let lead_cookie = register(&addr, &pool, &lead_email).await;
    let member_cookie = register(&addr, &pool, &member_email).await;
    let bystander_cookie = register(&addr, &pool, &bystander_email).await;

    // Owner creates org + team.
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_cookie)
        .json(&json!({ "slug": team_slug, "name": "Alpha" }))
        .send()
        .await
        .unwrap();

    // Add lead + member to the org via direct membership insert (avoids
    // the invite flow churn for this scope test).
    let org_id: Uuid = sqlx::query_scalar("SELECT id FROM orgs WHERE slug = $1")
        .bind(&org_slug)
        .fetch_one(&pool)
        .await
        .unwrap();
    let lead_id = user_id(&pool, &lead_email).await;
    let member_id = user_id(&pool, &member_email).await;
    for (uid, role) in [(lead_id, "member"), (member_id, "member")] {
        sqlx::query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)")
            .bind(org_id)
            .bind(uid)
            .bind(role)
            .execute(&pool)
            .await
            .unwrap();
    }
    // Make `lead` a team lead.
    let team_id: Uuid =
        sqlx::query_scalar("SELECT id FROM teams WHERE org_id = $1 AND slug = $2")
            .bind(org_id)
            .bind(team_slug)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'lead')")
        .bind(team_id)
        .bind(lead_id)
        .execute(&pool)
        .await
        .unwrap();
    // member also joins the team as 'member' so they can see team views.
    sqlx::query(
        "INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(team_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();

    // -- create three views --

    // owner: an org-scope view.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/views"))
        .header("cookie", &owner_cookie)
        .json(&json!({
            "scope": "org",
            "name": "All prod errors",
            "payload": { "query": "env:prod status:active" }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "owner→org: {}", r.text().await.unwrap());

    // lead: a team-scope view (allowed: team lead).
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/views"))
        .header("cookie", &lead_cookie)
        .json(&json!({
            "scope": "team",
            "teamSlug": team_slug,
            "name": "Alpha triage",
            "payload": { "query": "release:1.2.0" }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "lead→team: {}", r.text().await.unwrap());

    // member: tries team-scope but isn't lead → 403.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/views"))
        .header("cookie", &member_cookie)
        .json(&json!({
            "scope": "team",
            "teamSlug": team_slug,
            "name": "Member team-scoped fails",
            "payload": {}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403, "member team-scope must be forbidden");

    // member: tries org-scope but isn't admin → 403.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/views"))
        .header("cookie", &member_cookie)
        .json(&json!({
            "scope": "org",
            "name": "Member org-scoped fails",
            "payload": {}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403, "member org-scope must be forbidden");

    // member: personal-scope is always allowed.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/views"))
        .header("cookie", &member_cookie)
        .json(&json!({
            "scope": "personal",
            "name": "My noise filter",
            "payload": { "query": "errorType:Foo" }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "member→personal");
    let member_view_id = r.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // -- visibility checks --
    let owner_view = list_view_names(&addr, &org_slug, &owner_cookie).await;
    assert!(owner_view.contains(&"All prod errors".to_string()));
    assert!(owner_view.contains(&"Alpha triage".to_string()));
    // owner doesn't see member's personal:
    assert!(!owner_view.contains(&"My noise filter".to_string()));

    let member_view = list_view_names(&addr, &org_slug, &member_cookie).await;
    // Member sees: org + their team (since they're in alpha) + their own personal.
    assert!(member_view.contains(&"All prod errors".to_string()));
    assert!(member_view.contains(&"Alpha triage".to_string()));
    assert!(member_view.contains(&"My noise filter".to_string()));

    // bystander joins org but is not in alpha team → cannot see the team-scoped view.
    sqlx::query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'member')")
        .bind(org_id)
        .bind(user_id(&pool, &bystander_email).await)
        .execute(&pool)
        .await
        .unwrap();
    let bystander_view = list_view_names(&addr, &org_slug, &bystander_cookie).await;
    assert!(bystander_view.contains(&"All prod errors".to_string()));
    assert!(
        !bystander_view.contains(&"Alpha triage".to_string()),
        "non-team members must not see team-scoped views",
    );
    assert!(!bystander_view.contains(&"My noise filter".to_string()));

    // -- delete authz --
    // bystander cannot delete member's personal view.
    let r = Client::new()
        .delete(format!(
            "http://{addr}/api/orgs/{org_slug}/views/{member_view_id}"
        ))
        .header("cookie", &bystander_cookie)
        .send()
        .await
        .unwrap();
    assert!(
        r.status() == 403 || r.status() == 404,
        "bystander delete: {}",
        r.status()
    );

    // member can delete their own personal view.
    let r = Client::new()
        .delete(format!(
            "http://{addr}/api/orgs/{org_slug}/views/{member_view_id}"
        ))
        .header("cookie", &member_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
}
