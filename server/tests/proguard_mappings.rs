// Phase 22 sub-C integration tests for ProGuard mapping upload + retrace.
// Same skip-on-no-DATABASE_URL pattern as the dsym tests.

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
        dev_token: "st_pk_pgtest000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "pgtest".to_string(),
        session_secret: "pgtest-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-pg-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-pg-1234" }))
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

const MAPPING: &[u8] = b"\
# pg_map_id: 1234abcd-deadbeef
com.example.OriginalClass -> com.example.a:
    void originalMethod() -> b
";

#[tokio::test]
async fn upload_lists_with_sniffed_debug_id() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("pg-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-pg-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

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
    let project_id = proj["id"].as_str().unwrap();

    // Upload — server should sniff "# pg_map_id: 1234abcd-deadbeef".
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/mappings?release=app%401.0.0"
        ))
        .header("cookie", &cookie)
        .header("content-type", "application/octet-stream")
        .body(MAPPING.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["debugId"].as_str().unwrap(), "1234abcd-deadbeef");
    assert_eq!(body["sizeBytes"].as_i64().unwrap(), MAPPING.len() as i64);

    // List endpoint surfaces the row.
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/mappings"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["debugId"].as_str().unwrap(), "1234abcd-deadbeef");
    assert_eq!(rows[0]["release"].as_str().unwrap(), "app@1.0.0");
}

#[tokio::test]
async fn upload_rejects_empty_body() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("pg-empty-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-pe-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

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
    let project_id = proj["id"].as_str().unwrap();

    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/mappings"
        ))
        .header("cookie", &cookie)
        .body(Vec::<u8>::new())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
}
