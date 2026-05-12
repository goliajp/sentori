// Phase 28 sub-A: Cmd+K search endpoint.
//
// Verifies cross-type results (org / team / project / issue / member),
// per-type filter via `?types=`, and visibility scoping (a user not in
// org X never sees X's projects/issues even on a literal-name match).

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
        dev_token: "st_pk_search0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "se".to_string(),
        session_secret: "se-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-search-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-search-1234" }))
        .send()
        .await
        .unwrap();
    login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .unwrap()
}

#[tokio::test]
async fn search_returns_cross_type_hits_within_my_orgs() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let me_email = format!("me-{salt}@golia.test");
    let her_email = format!("her-{salt}@golia.test");
    let my_org = format!("morg-{salt}");
    let her_org = format!("horg-{salt}");

    let me = register(&addr, &pool, &me_email).await;
    let her = register(&addr, &pool, &her_email).await;

    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &me)
        .json(&json!({ "slug": my_org, "name": "BurnerOrg Searchable" }))
        .send()
        .await
        .unwrap();
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &her)
        .json(&json!({ "slug": her_org, "name": "HerOrg Searchable" }))
        .send()
        .await
        .unwrap();

    // Project + issue inside my org.
    let proj_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{my_org}/projects"))
        .header("cookie", &me)
        .json(&json!({ "name": "BurnerProj-Searchable" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap();
    let issue_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO issues (id, project_id, fingerprint, error_type, message_sample, status, \
         first_seen, last_seen, event_count, last_environment, last_release) \
         VALUES ($1, $2, $3, 'BurnerCustomError', 'something broke', 'active', \
         now(), now(), 1, 'prod', 'myapp@1.0.0')",
    )
    .bind(issue_id)
    .bind(project_id)
    .bind(format!("fp-{salt}"))
    .execute(&pool)
    .await
    .unwrap();

    // me searches for the unique token.
    let r = Client::new()
        .get(format!("http://{addr}/admin/api/search?q=Burner"))
        .header("cookie", &me)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let hits: Vec<Value> = r.json().await.unwrap();
    let kinds: Vec<&str> = hits.iter().map(|h| h["type"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"org"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"project"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"issue"), "kinds: {kinds:?}");

    // her searches for the same token — must NOT see my project / issue.
    let r = Client::new()
        .get(format!("http://{addr}/admin/api/search?q=Burner"))
        .header("cookie", &her)
        .send()
        .await
        .unwrap();
    let hits: Vec<Value> = r.json().await.unwrap();
    for h in &hits {
        let url = h["url"].as_str().unwrap();
        assert!(
            !url.contains(&my_org),
            "her unexpectedly saw my org artifact: {url}"
        );
    }
}

#[tokio::test]
async fn search_filters_by_types_param() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("st-{salt}@golia.test");
    let org_slug = format!("torg-{salt}");
    let cookie = register(&addr, &pool, &email).await;
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": "TypesFilter PROBE" }))
        .send()
        .await
        .unwrap();
    Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &cookie)
        .json(&json!({ "name": "TypesFilter PROBE Project" }))
        .send()
        .await
        .unwrap();

    let r = Client::new()
        .get(format!("http://{addr}/admin/api/search?q=PROBE&types=project"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let hits: Vec<Value> = r.json().await.unwrap();
    for h in &hits {
        assert_eq!(h["type"].as_str().unwrap(), "project", "types= filter strict");
    }
    assert!(!hits.is_empty(), "at least one project hit");
}
