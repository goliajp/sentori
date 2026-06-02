// v1.0 — comprehensive account-module integration tests.
//
// Skips cleanly when DATABASE_URL isn't set (same convention as
// sessions.rs / user_activity.rs). Covers the routes mounted under
// `/api/auth/*` end-to-end against a real Postgres:
//
//   register → verify → login          happy path + the obvious wrong-
//                                       password / unverified-user 403s
//   forgot-password → reset            includes single-use guarantee
//   GET /me                            requires session; returns full
//                                       profile shape (display, avatar,
//                                       email_verified, is_superadmin,
//                                       oauth_provider)
//   PATCH /me                          display_name + avatar_url
//   POST /change-password              requires current password +
//                                       invalidates other sessions
//   POST /sign-out-everywhere          keeps current session alive
//   GET  /oauth/providers              env-gated; non-empty values
//                                       required (regression fence for
//                                       the empty-string is_ok() bug)
//   GET  /oauth/{provider}/start       sets state cookie + 303s to
//                                       the provider's authorize URL
//   GET  /oauth/{provider}/callback    state mismatch returns 400
//
// Each test uses a UUID-suffix email so the DB doesn't have to be
// truncated between runs.

use std::net::SocketAddr;

use reqwest::{Client, header::HeaderMap};
use sentori_server::{db, router};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;

const PW: &str = "pw-acct-1234";

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_acct000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "acct".to_string(),
        session_secret: "acct-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Some((addr, pool))
}

/// Pull a Set-Cookie value out of a response by name. Returns
/// `"name=value"` ready to drop into a subsequent `cookie:` header.
fn cookie_named<'a>(headers: &'a HeaderMap, name: &str) -> Option<String> {
    headers.get_all("set-cookie").iter().find_map(|v| {
        let s = v.to_str().ok()?;
        let first = s.split(';').next()?;
        let key = first.split('=').next()?;
        if key == name { Some(first.to_string()) } else { None }
    })
}

fn uniq() -> String {
    Uuid::now_v7().simple().to_string()[..12].to_string()
}

/// Register + verify + login. Returns the session-cookie string,
/// already in `sentori_session=<id>` form.
async fn fresh_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    let base = format!("http://{addr}");

    let reg = Client::new()
        .post(format!("{base}/api/auth/register"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    assert!(reg.status().is_success(), "register {} -> {}", email, reg.status());

    let token: String = sqlx::query_scalar(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id WHERE u.email = $1",
    )
    .bind(email)
    .fetch_one(pool)
    .await
    .unwrap();
    let ver = Client::new()
        .get(format!("{base}/api/auth/verify?token={token}"))
        .send()
        .await
        .unwrap();
    assert!(ver.status().is_success(), "verify -> {}", ver.status());

    let login = Client::new()
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    assert!(login.status().is_success(), "login -> {}", login.status());
    cookie_named(login.headers(), "sentori_session").expect("session cookie")
}

// ─── register / verify / login ──────────────────────────────────────

#[tokio::test]
async fn register_verify_login_happy_path() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-happy-{}@golia.test", uniq());
    let sess = fresh_user(&addr, &pool, &email).await;

    // /me reflects the freshly-issued session and reports verified.
    let me = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .header("cookie", &sess)
        .send()
        .await
        .unwrap();
    assert_eq!(me.status(), 200);
    let body: Value = me.json().await.unwrap();
    assert_eq!(body["user"]["email"], email);
    assert_eq!(body["user"]["emailVerified"], true);
    assert_eq!(body["user"]["isSuperadmin"], false);
}

#[tokio::test]
async fn login_unverified_is_rejected() {
    let Some((addr, _pool)) = setup().await else { return };
    let email = format!("acct-unverified-{}@golia.test", uniq());

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    // Note: no /verify step.
    let login = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    // 403 = emailNotVerified path; we just want anything non-2xx.
    assert!(!login.status().is_success(), "login should reject unverified");
}

#[tokio::test]
async fn login_wrong_password_rejected() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-wrongpw-{}@golia.test", uniq());
    let _ = fresh_user(&addr, &pool, &email).await;

    let resp = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": "totally-wrong-pw" }))
        .send()
        .await
        .unwrap();
    assert!(!resp.status().is_success(), "login should reject wrong pw");
}

// ─── forgot / reset ─────────────────────────────────────────────────

#[tokio::test]
async fn forgot_password_then_reset_login() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-fp-{}@golia.test", uniq());
    let _ = fresh_user(&addr, &pool, &email).await;

    // Always 200, regardless of whether email matches.
    let fp = Client::new()
        .post(format!("http://{addr}/api/auth/forgot-password"))
        .json(&json!({ "email": email }))
        .send()
        .await
        .unwrap();
    assert_eq!(fp.status(), 200);

    let token: String = sqlx::query_scalar(
        "SELECT rt.token FROM password_resets rt \
         JOIN users u ON u.id = rt.user_id WHERE u.email = $1 \
         ORDER BY rt.created_at DESC LIMIT 1",
    )
    .bind(&email)
    .fetch_one(&pool)
    .await
    .unwrap();

    let new_pw = "new-pw-after-reset-9876";
    let reset = Client::new()
        .post(format!("http://{addr}/api/auth/reset-password"))
        .json(&json!({ "token": token, "password": new_pw }))
        .send()
        .await
        .unwrap();
    assert_eq!(reset.status(), 200, "reset response: {:?}", reset.text().await);

    // Old password no longer works.
    let old = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    assert!(!old.status().is_success(), "old pw should be rejected");

    // New password works.
    let new = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": new_pw }))
        .send()
        .await
        .unwrap();
    assert!(new.status().is_success(), "new pw should authenticate");
}

#[tokio::test]
async fn reset_token_is_single_use() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-fp-single-{}@golia.test", uniq());
    let _ = fresh_user(&addr, &pool, &email).await;

    Client::new()
        .post(format!("http://{addr}/api/auth/forgot-password"))
        .json(&json!({ "email": email }))
        .send()
        .await
        .unwrap();
    let token: String = sqlx::query_scalar(
        "SELECT rt.token FROM password_resets rt \
         JOIN users u ON u.id = rt.user_id WHERE u.email = $1 \
         ORDER BY rt.created_at DESC LIMIT 1",
    )
    .bind(&email)
    .fetch_one(&pool)
    .await
    .unwrap();

    let first = Client::new()
        .post(format!("http://{addr}/api/auth/reset-password"))
        .json(&json!({ "token": token, "password": "first-use-pw-1111" }))
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 200);

    let second = Client::new()
        .post(format!("http://{addr}/api/auth/reset-password"))
        .json(&json!({ "token": token, "password": "second-use-pw-2222" }))
        .send()
        .await
        .unwrap();
    assert!(
        !second.status().is_success(),
        "second use of single-use token must be rejected"
    );
}

// ─── /me / PATCH /me ────────────────────────────────────────────────

#[tokio::test]
async fn me_requires_session() {
    let Some((addr, _pool)) = setup().await else { return };
    let resp = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn patch_me_updates_profile() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-patch-{}@golia.test", uniq());
    let sess = fresh_user(&addr, &pool, &email).await;

    let patch = Client::new()
        .patch(format!("http://{addr}/api/auth/me"))
        .header("cookie", &sess)
        .json(&json!({ "displayName": "Renamed Dev", "avatarUrl": "https://example.com/a.png" }))
        .send()
        .await
        .unwrap();
    assert_eq!(patch.status(), 200);

    let me = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .header("cookie", &sess)
        .send()
        .await
        .unwrap();
    let body: Value = me.json().await.unwrap();
    assert_eq!(body["user"]["displayName"], "Renamed Dev");
    assert_eq!(body["user"]["avatarUrl"], "https://example.com/a.png");
}

// ─── change-password ────────────────────────────────────────────────

#[tokio::test]
async fn change_password_requires_current_password() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-cp-{}@golia.test", uniq());
    let sess = fresh_user(&addr, &pool, &email).await;

    let bad = Client::new()
        .post(format!("http://{addr}/api/auth/change-password"))
        .header("cookie", &sess)
        .json(&json!({ "currentPassword": "wrong", "newPassword": "next-pw-1234567" }))
        .send()
        .await
        .unwrap();
    assert!(
        !bad.status().is_success(),
        "wrong current password must be rejected"
    );

    let ok = Client::new()
        .post(format!("http://{addr}/api/auth/change-password"))
        .header("cookie", &sess)
        .json(&json!({ "currentPassword": PW, "newPassword": "next-pw-1234567" }))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
}

#[tokio::test]
async fn change_password_invalidates_other_sessions() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-cp2-{}@golia.test", uniq());
    let session_a = fresh_user(&addr, &pool, &email).await;

    // Open a second session as the same user.
    let login_b = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    let session_b =
        cookie_named(login_b.headers(), "sentori_session").expect("session b cookie");
    assert_ne!(session_a, session_b, "two distinct sessions");

    // Change password via session A.
    let cp = Client::new()
        .post(format!("http://{addr}/api/auth/change-password"))
        .header("cookie", &session_a)
        .json(&json!({ "currentPassword": PW, "newPassword": "rotated-pw-9999" }))
        .send()
        .await
        .unwrap();
    assert_eq!(cp.status(), 200);

    // Session A is still valid.
    let me_a = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .header("cookie", &session_a)
        .send()
        .await
        .unwrap();
    assert_eq!(me_a.status(), 200);

    // Session B is dead.
    let me_b = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .header("cookie", &session_b)
        .send()
        .await
        .unwrap();
    assert_eq!(me_b.status(), 401, "other session must be killed");
}

// ─── sign-out-everywhere ────────────────────────────────────────────

#[tokio::test]
async fn sign_out_everywhere_preserves_current() {
    let Some((addr, pool)) = setup().await else { return };
    let email = format!("acct-soe-{}@golia.test", uniq());
    let session_a = fresh_user(&addr, &pool, &email).await;

    let login_b = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": PW }))
        .send()
        .await
        .unwrap();
    let session_b =
        cookie_named(login_b.headers(), "sentori_session").expect("session b cookie");

    let soe = Client::new()
        .post(format!("http://{addr}/api/auth/sign-out-everywhere"))
        .header("cookie", &session_a)
        .send()
        .await
        .unwrap();
    assert_eq!(soe.status(), 200);

    // A keeps working, B is dead.
    let me_a = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .header("cookie", &session_a)
        .send()
        .await
        .unwrap();
    assert_eq!(me_a.status(), 200, "current session preserved");

    let me_b = Client::new()
        .get(format!("http://{addr}/api/auth/me"))
        .header("cookie", &session_b)
        .send()
        .await
        .unwrap();
    assert_eq!(me_b.status(), 401, "other session killed");
}

// ─── OAuth providers / start / callback ─────────────────────────────
//
// All OAuth-config branches share the same global env. Run them in a
// single test (serial within the test) and guard the whole block with
// a module-level mutex so we don't race the env vars with any other
// test that might touch them.

static OAUTH_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn oauth_end_to_end_routing() {
    let Some((addr, _pool)) = setup().await else { return };
    let _guard = OAUTH_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    // ─── Snapshot env so we can restore on the way out.
    let keys = [
        "SENTORI_GITHUB_CLIENT_ID",
        "SENTORI_GITHUB_CLIENT_SECRET",
        "SENTORI_GOOGLE_CLIENT_ID",
        "SENTORI_GOOGLE_CLIENT_SECRET",
    ];
    let saved: Vec<(&str, Option<String>)> = keys
        .iter()
        .map(|k| (*k, std::env::var(k).ok()))
        .collect();

    // ─── Branch 1: empty values → both providers report off.
    // This is the regression fence for the previous bug where
    // `is_ok()` reported the empty string as configured.
    for k in &keys {
        unsafe { std::env::set_var(k, "") };
    }
    let resp = Client::new()
        .get(format!("http://{addr}/api/auth/oauth/providers"))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["github"], false, "empty env => github off");
    assert_eq!(body["google"], false, "empty env => google off");

    // ─── Branch 2: with real-shaped values, /start redirects to the
    // provider with the right client_id + state cookie.
    unsafe {
        std::env::set_var("SENTORI_GITHUB_CLIENT_ID", "test-client-id");
        std::env::set_var("SENTORI_GITHUB_CLIENT_SECRET", "test-secret");
    }
    let providers: Value = Client::new()
        .get(format!("http://{addr}/api/auth/oauth/providers"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(providers["github"], true, "github should now be on");
    assert_eq!(providers["google"], false, "google still off");

    let no_redirect = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let start = no_redirect
        .get(format!("http://{addr}/api/auth/oauth/github/start"))
        .send()
        .await
        .unwrap();
    assert!(
        start.status().is_redirection(),
        "expected redirect, got {}",
        start.status()
    );
    let location = start
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        location.starts_with("https://github.com/login/oauth/authorize"),
        "location did not point at github: {location}"
    );
    assert!(
        location.contains("client_id=test-client-id"),
        "client_id missing from authorize URL: {location}"
    );
    assert!(
        cookie_named(start.headers(), "sentori_oauth_state").is_some(),
        "state cookie must be set on start"
    );

    // ─── Branch 3: callback with state mismatch returns 400 (without
    // ever touching the network for token exchange).
    let mismatch = no_redirect
        .get(format!(
            "http://{addr}/api/auth/oauth/github/callback?code=abc&state=does-not-match"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(mismatch.status(), 400, "state mismatch must 400");

    // ─── Restore.
    for (k, v) in &saved {
        unsafe {
            match v {
                Some(val) => std::env::set_var(k, val),
                None => std::env::remove_var(k),
            }
        }
    }
}
