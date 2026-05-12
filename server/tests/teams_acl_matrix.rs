// Phase 18 sub-I-1: exhaustive ACL matrix.
//
// Sets up one org with four callers (owner / admin / member / non-member)
// + one pre-existing team + one project, then asserts the status code
// returned by each access-controlled endpoint per role. Catches drift in
// either direction — accidentally tightening (403s on legitimate reads)
// or accidentally loosening (200s where we should 403).

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;

const BAD_TOKEN: &str = "st_pk_aclmatrix000000000000000000";

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;

    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: BAD_TOKEN.to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "aclmatrix".to_string(),
        session_secret: "aclmatrix-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-aclmatrix-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-aclmatrix-1234" }))
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

struct Fixture {
    addr: SocketAddr,
    org_slug: String,
    project_id: Uuid,
    member_user_id: Uuid,
    cookies: [(&'static str, String); 4],
}

const ROLES: [&str; 4] = ["owner", "admin", "member", "nonmember"];

async fn build_fixture() -> Option<Fixture> {
    let (addr, pool) = setup().await?;

    // Cargo runs tests in parallel; nanos prefix collisions caused 409s,
    // so include a uuid-derived 8-char tail to keep org slugs unique.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let id_tail = Uuid::now_v7().simple().to_string();
    let suffix = format!("{nanos}-{}", &id_tail[12..28]);
    let org_slug = format!("org-acl-{}", &id_tail[12..28]);

    let owner_email = format!("acl-owner-{suffix}@golia.test");
    let admin_email = format!("acl-admin-{suffix}@golia.test");
    let member_email = format!("acl-member-{suffix}@golia.test");
    let outsider_email = format!("acl-outsider-{suffix}@golia.test");

    let (_owner_id, owner_c) = register_user(&addr, &pool, &owner_email).await;
    let (_admin_id, admin_c) = register_user(&addr, &pool, &admin_email).await;
    let (member_id, member_c) = register_user(&addr, &pool, &member_email).await;
    let (_outsider_id, outsider_c) = register_user(&addr, &pool, &outsider_email).await;

    // Create org owned by owner.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner_c)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);

    // Invite admin and member.
    for (email, role, cookie) in [
        (&admin_email, "admin", &admin_c),
        (&member_email, "member", &member_c),
    ] {
        let inv = Client::new()
            .post(format!("http://{addr}/api/orgs/{org_slug}/invites"))
            .header("cookie", &owner_c)
            .json(&json!({ "email": email, "role": role }))
            .send()
            .await
            .unwrap();
        assert_eq!(inv.status(), 201);
        let body: Value = inv.json().await.unwrap();
        let token = body["token"].as_str().unwrap();
        Client::new()
            .post(format!("http://{addr}/api/invites/{token}/accept"))
            .header("cookie", cookie)
            .send()
            .await
            .unwrap();
    }

    // Pre-create a team (slug: alpha) so patch / delete / add-member can target it.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &owner_c)
        .json(&json!({ "slug": "alpha", "name": "Alpha" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);

    // Pre-create a project.
    let r = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &owner_c)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);
    let body: Value = r.json().await.unwrap();
    let project_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    Some(Fixture {
        addr,
        org_slug,
        project_id,
        member_user_id: member_id,
        cookies: [
            ("owner", owner_c),
            ("admin", admin_c),
            ("member", member_c),
            ("nonmember", outsider_c),
        ],
    })
}

fn cookie_for<'a>(fx: &'a Fixture, role: &str) -> &'a str {
    fx.cookies
        .iter()
        .find(|(r, _)| *r == role)
        .map(|(_, c)| c.as_str())
        .unwrap()
}

/// Tiny matrix runner: for each role, hit the endpoint once and assert
/// the expected status. `actor` runs the closure and returns the status.
async fn assert_matrix<F, Fut>(fx: &Fixture, label: &str, expected: [u16; 4], actor: F)
where
    F: Fn(Client, String) -> Fut,
    Fut: std::future::Future<Output = u16>,
{
    for (i, role) in ROLES.iter().enumerate() {
        let cookie = cookie_for(fx, role).to_string();
        let got = actor(Client::new(), cookie).await;
        assert_eq!(
            got, expected[i],
            "{label}: role={role} expected {} got {}",
            expected[i], got
        );
    }
}

#[tokio::test]
async fn create_team_matrix() {
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let slug = fx.org_slug.clone();
    // 20 hex chars from a uuid v7 are unique within one ms — enough so
    // the four parallel matrix calls don't collide on slug-taken (409).
    assert_matrix(
        &fx,
        "create_team",
        [201, 201, 403, 404],
        |c, cookie| {
            let slug = slug.clone();
            async move {
                let team_slug =
                    format!("t-{}", &Uuid::now_v7().simple().to_string()[12..28]);
                let body = json!({ "slug": team_slug, "name": "Team" });
                c.post(format!("http://{}/api/orgs/{}/teams", fx.addr, slug))
                    .header("cookie", cookie)
                    .json(&body)
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16()
            }
        },
    )
    .await;
}

#[tokio::test]
async fn patch_team_matrix() {
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let slug = fx.org_slug.clone();
    assert_matrix(
        &fx,
        "patch_team",
        [200, 200, 403, 404],
        |c, cookie| {
            let slug = slug.clone();
            async move {
                c.patch(format!("http://{}/api/orgs/{}/teams/alpha", fx.addr, slug))
                    .header("cookie", cookie)
                    .json(&json!({ "name": "Alpha-renamed" }))
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16()
            }
        },
    )
    .await;
}

#[tokio::test]
async fn list_teams_matrix() {
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let slug = fx.org_slug.clone();
    // list_teams: any org member can read; non-member 404 (orgNotFound).
    assert_matrix(
        &fx,
        "list_teams",
        [200, 200, 200, 404],
        |c, cookie| {
            let slug = slug.clone();
            async move {
                c.get(format!("http://{}/api/orgs/{}/teams", fx.addr, slug))
                    .header("cookie", cookie)
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16()
            }
        },
    )
    .await;
}

#[tokio::test]
async fn add_team_member_matrix() {
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let slug = fx.org_slug.clone();
    let member_id = fx.member_user_id;
    // Add the *member* user into team alpha — 201 from owner & admin
    // (idempotent on conflict), 403 from plain member (no team-lead role
    // here), 404 from outsider (orgNotFound short-circuits before team
    // lookup).
    assert_matrix(
        &fx,
        "add_team_member",
        [201, 201, 403, 404],
        |c, cookie| {
            let slug = slug.clone();
            async move {
                c.post(format!(
                    "http://{}/api/orgs/{}/teams/alpha/members",
                    fx.addr, slug
                ))
                .header("cookie", cookie)
                .json(&json!({ "userId": member_id, "role": "member" }))
                .send()
                .await
                .unwrap()
                .status()
                .as_u16()
            }
        },
    )
    .await;
}

#[tokio::test]
async fn project_bind_matrix() {
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let project_id = fx.project_id;
    // Project↔team bind goes through admin router + require_project_in_org:
    //   owner   → 201 (idempotent)
    //   admin   → 201
    //   member  → 200 from middleware (user is in org), 403 from
    //             caller_is_org_admin handler check
    //   outsider→ 403 from middleware (projectNotInOrg)
    assert_matrix(
        &fx,
        "project_bind",
        [201, 201, 403, 403],
        |c, cookie| async move {
            c.post(format!(
                "http://{}/admin/api/projects/{}/teams/alpha",
                fx.addr, project_id
            ))
            .header("cookie", cookie)
            .send()
            .await
            .unwrap()
            .status()
            .as_u16()
        },
    )
    .await;
}

#[tokio::test]
async fn delete_team_matrix() {
    // Run last in alphabetical order so the team still exists for the
    // earlier tests; but each test has its own fixture, so isolation is
    // already provided by build_fixture creating a unique org.
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let slug = fx.org_slug.clone();

    // Re-create alpha each non-success branch since 200 from owner deletes it.
    // We exercise the order: nonmember → 404, member → 403, admin → 200,
    // owner → 200 on a fresh team.
    let cases: [(&str, u16); 4] = [
        ("nonmember", 404),
        ("member", 403),
        ("admin", 200),
        ("owner", 200),
    ];
    for (role, expected) in cases {
        // Ensure a team named alpha exists for this case.
        let owner_c = cookie_for(&fx, "owner").to_string();
        let _ = Client::new()
            .post(format!("http://{}/api/orgs/{}/teams", fx.addr, slug))
            .header("cookie", &owner_c)
            .json(&json!({ "slug": "alpha", "name": "Alpha" }))
            .send()
            .await
            .unwrap();
        let cookie = cookie_for(&fx, role).to_string();
        let got = Client::new()
            .delete(format!("http://{}/api/orgs/{}/teams/alpha", fx.addr, slug))
            .header("cookie", cookie)
            .send()
            .await
            .unwrap()
            .status()
            .as_u16();
        assert_eq!(
            got, expected,
            "delete_team: role={role} expected {expected} got {got}"
        );
    }
}

#[tokio::test]
async fn no_session_returns_401() {
    let Some(fx) = build_fixture().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // No cookie at all → 401 from require_user middleware.
    let got = Client::new()
        .post(format!("http://{}/api/orgs/{}/teams", fx.addr, fx.org_slug))
        .json(&json!({ "slug": "noauth", "name": "x" }))
        .send()
        .await
        .unwrap()
        .status()
        .as_u16();
    assert_eq!(got, 401, "missing session → 401");
}
