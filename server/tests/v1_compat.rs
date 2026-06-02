//! v2.0 W1 — server back-compat regression for v1 SDK wire shape.
//!
//! Sentori v2 server adds the `kind: 'message'` event family along
//! with optional `level` + `message` columns. The user-facing
//! contract is: **v1 SDK requests keep working forever**. This test
//! file pins that down by posting v1.0.0-shaped payloads (no
//! `level`, no `message`, `error` required) against the v2 server
//! and asserting the response is still `202 Accepted`.
//!
//! Failing any case here means the v2 server has accidentally
//! broken backwards compatibility — that's a stop-ship.

use std::net::SocketAddr;

use sentori_server::router;
use serde_json::json;
use tokio::net::TcpListener;
use uuid::Uuid;

const TOKEN: &str = "st_pk_test01j5y9z3vk8x4rmt2pcq";

async fn spawn() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router::build(router::ServerConfig {
        dev_token: TOKEN.to_string(),
        db: None,
        valkey: None,
        project_id: sentori_server::seed::DEV_PROJECT_ID,
        rate_limit_per_min: 10_000,
        admin_password: "test".to_string(),
        session_secret: "test-secret".to_string(),
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

    addr
}

/// v1.0.0-rc.1 wire shape — what the very first GA SDK produced.
fn v1_error_event() -> serde_json::Value {
    json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-05-09T12:34:56.789Z",
        "kind": "error",
        "platform": "javascript",
        "release": "myapp@1.2.3+456",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "1.2.3" },
        "error": {
            "type": "TypeError",
            "message": "test",
            "stack": [{ "file": "a.ts", "line": 1, "inApp": true }]
        }
    })
}

#[tokio::test]
async fn v1_sdk_error_payload_accepted() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "test/1.0.0")
        .json(&v1_error_event())
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        202,
        "v1 SDK error-kind payload must keep working on v2 server"
    );
}

#[tokio::test]
async fn v1_sdk_anr_payload_accepted() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let mut payload = v1_error_event();
    payload["kind"] = json!("anr");
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202, "v1 SDK anr-kind payload must keep working");
}

#[tokio::test]
async fn v1_sdk_nearcrash_payload_accepted() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let mut payload = v1_error_event();
    payload["kind"] = json!("nearCrash");
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        202,
        "v1 SDK nearCrash-kind payload must keep working"
    );
}

#[tokio::test]
async fn v2_message_event_accepted() {
    // The complementary direction: v2 SDK shape is also valid on the
    // same server (no separate code path needed).
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-05-22T00:00:00.000Z",
        "kind": "message",
        "level": "warning",
        "message": "Payment provider returned 500, used fallback",
        "platform": "javascript",
        "release": "myapp@2.0.0",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "2.0.0" },
        "tags": { "feature": "checkout" },
    });
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "test/2.0.0")
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202, "v2 SDK message-kind payload should be accepted");
}

#[tokio::test]
async fn v2_message_event_missing_level_rejected() {
    // Cross-field validation: kind=message requires level. This is
    // the v2.0 validate_event_kind contract.
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-05-22T00:00:00.000Z",
        "kind": "message",
        // no level
        "message": "missing level should 400",
        "platform": "javascript",
        "release": "myapp@2.0.0",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "2.0.0" },
    });
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn v2_message_event_missing_message_rejected() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-05-22T00:00:00.000Z",
        "kind": "message",
        "level": "info",
        // no message
        "platform": "javascript",
        "release": "myapp@2.0.0",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "2.0.0" },
    });
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn error_kind_missing_error_rejected() {
    // The mirror direction: kind=error MUST carry error object.
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-05-22T00:00:00.000Z",
        "kind": "error",
        // no error object
        "platform": "javascript",
        "release": "myapp@2.0.0",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "2.0.0" },
    });
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

/// v2.0 — error fingerprint must include the (normalised) message
/// so "pinning mismatch (mode=block)" and "pinning mismatch
/// (mode=alert-only)" thrown from the same callsite land on
/// distinct issues. Pre-v2.0 grouping collapsed both into one,
/// making triage impossible.
#[test]
fn error_fingerprint_splits_by_message_mode() {
    use sentori_server::event::Event;
    use sentori_server::grouping::fingerprint;

    fn make(msg: &str, release: &str) -> Event {
        let payload = json!({
            "id": Uuid::now_v7().to_string(),
            "timestamp": "2026-05-22T00:00:00.000Z",
            "kind": "error",
            "platform": "javascript",
            "release": release,
            "environment": "prod",
            "device": { "os": "ios", "osVersion": "17.4" },
            "app": { "version": "5.4.0" },
            "error": {
                "type": "Error",
                "message": msg,
                "stack": [{ "file": "index.android.bundle", "line": 3227661, "function": "reportMismatch", "inApp": true }]
            }
        });
        serde_json::from_value(payload).expect("v1 error event should deserialize")
    }

    let block = make("pinning mismatch on identity.focusai.com (mode=block)", "focus-ai-app@5.4.0");
    let alert = make("pinning mismatch on identity.focusai.com (mode=alert-only)", "focus-ai-app@5.4.0");
    assert_ne!(
        fingerprint(&block),
        fingerprint(&alert),
        "different `mode=` in the error message must produce distinct fingerprints"
    );

    let block_again = make("pinning mismatch on identity.focusai.com (mode=block)", "focus-ai-app@5.4.0");
    assert_eq!(
        fingerprint(&block),
        fingerprint(&block_again),
        "identical (type, message, frame, release) must group"
    );
}

/// v2.1 (reversed from intermediate v2.0 decision) — error
/// fingerprint includes release, so the same exception in `5.3` and
/// `5.4` lands on distinct issues.
///
/// History: v2.0 W1 originally split by release. Mid-v2.0 I removed
/// release to preserve Sentry-style cross-release `resolved →
/// regressed` flip on a shared issue row. Post-dogfood user
/// feedback (2026-05-22): per-release isolation reads cleaner than
/// the regression-flip semantics. Switched back. The
/// "did a fixed bug come back?" question is now answered via a
/// related-issues panel on the issue page rather than merging the
/// rows.
#[test]
fn error_fingerprint_splits_by_release() {
    use sentori_server::event::Event;
    use sentori_server::grouping::fingerprint;

    fn make(release: &str) -> Event {
        let payload = json!({
            "id": Uuid::now_v7().to_string(),
            "timestamp": "2026-05-22T00:00:00.000Z",
            "kind": "error",
            "platform": "javascript",
            "release": release,
            "environment": "prod",
            "device": { "os": "ios", "osVersion": "17.4" },
            "app": { "version": "5.4.0" },
            "error": {
                "type": "TypeError",
                "message": "Cannot read property foo of undefined",
                "stack": [{ "file": "a.ts", "line": 1, "function": "handler", "inApp": true }]
            }
        });
        serde_json::from_value(payload).expect("v1 error event should deserialize")
    }

    let r53 = make("focus-ai-app@5.3.0");
    let r54 = make("focus-ai-app@5.4.0");
    assert_ne!(
        fingerprint(&r53),
        fingerprint(&r54),
        "same exception in different releases must produce distinct fingerprints \
         (post-2026-05-22 per-release isolation policy)"
    );
}

/// v2.0 — error fingerprint still normalises digit runs so dynamic
/// IDs don't fragment grouping below the "same condition" level.
#[test]
fn error_fingerprint_normalises_digit_runs() {
    use sentori_server::event::Event;
    use sentori_server::grouping::fingerprint;

    fn make(msg: &str) -> Event {
        let payload = json!({
            "id": Uuid::now_v7().to_string(),
            "timestamp": "2026-05-22T00:00:00.000Z",
            "kind": "error",
            "platform": "javascript",
            "release": "app@1.0.0",
            "environment": "prod",
            "device": { "os": "ios", "osVersion": "17.4" },
            "app": { "version": "1.0.0" },
            "error": {
                "type": "Error",
                "message": msg,
                "stack": [{ "file": "a.ts", "line": 1, "function": "h", "inApp": true }]
            }
        });
        serde_json::from_value(payload).expect("v1 error event should deserialize")
    }

    let a = make("User 12345 timed out");
    let b = make("User 67890 timed out");
    assert_eq!(
        fingerprint(&a),
        fingerprint(&b),
        "different digit-run IDs in the same message must still group together"
    );
}

/// Unit test for the grouping fingerprint logic — message events
/// should group by normalised body so "User 12345 fell back" and
/// "User 67890 fell back" land on the same issue.
#[test]
fn message_fingerprint_groups_by_normalised_body() {
    use sentori_server::event::Event;
    use sentori_server::grouping::fingerprint;

    fn make(msg: &str) -> Event {
        let payload = json!({
            "id": Uuid::now_v7().to_string(),
            "timestamp": "2026-05-22T00:00:00.000Z",
            "kind": "message",
            "level": "warning",
            "message": msg,
            "platform": "javascript",
            "release": "app@1.0.0",
            "environment": "prod",
            "device": { "os": "ios", "osVersion": "17.4" },
            "app": { "version": "1.0.0" },
        });
        serde_json::from_value(payload).expect("v2 message event should deserialize")
    }

    let a = make("User 12345 fell back to provider B");
    let b = make("User 67890 fell back to provider B");
    assert_eq!(
        fingerprint(&a),
        fingerprint(&b),
        "messages should group by normalised body (digit runs replaced)"
    );

    let c = make("Database connection timed out");
    assert_ne!(
        fingerprint(&a),
        fingerprint(&c),
        "different bodies should group differently"
    );
}
