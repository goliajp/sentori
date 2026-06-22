//! `project` + `token` subcommand impls — operate on the
//! `/admin/api/*` REST surface that's session-gated in v0.2.

use anyhow::{Context, Result};
use serde_json::Value;

const DEFAULT_API_URL: &str = "https://sentori.golia.jp";

fn resolve_api_url(arg: Option<String>) -> String {
    arg.or_else(|| std::env::var("SENTORI_ADMIN_URL").ok())
        .unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

fn token_value(arg: Option<String>) -> Result<String> {
    arg.or_else(|| std::env::var("SENTORI_ADMIN_TOKEN").ok())
        .or_else(|| std::env::var("SENTORI_TOKEN").ok())
        .context(
            "no admin token provided — pass --token or set SENTORI_ADMIN_TOKEN / SENTORI_TOKEN",
        )
}

fn client(token: &str) -> Result<reqwest::Client> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    Ok(reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(20))
        .build()?)
}

// ── project ────────────────────────────────────────────────

pub async fn project_list(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/v1/projects", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Vec<Value> = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
    } else {
        println!("{:<38}  {:<24}  name", "id", "slug");
        for p in &body {
            println!(
                "{:<38}  {:<24}  {}",
                p["id"].as_str().unwrap_or("?"),
                p["slug"].as_str().unwrap_or("?"),
                p["name"].as_str().unwrap_or("?"),
            );
        }
    }
    Ok(())
}

pub async fn project_create(
    name: String,
    slug: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/admin/api/projects", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c
        .post(&url)
        .json(&serde_json::json!({ "name": name, "slug": slug }))
        .send()
        .await?
        .error_for_status()?;
    let body: Value = resp.json().await?;
    println!("created project {}", body["id"]);
    println!("  name: {}", body["name"]);
    println!("  slug: {}", body["slug"]);
    Ok(())
}

pub async fn project_delete(
    project_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/admin/api/projects/{project_id}", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("deleted project {project_id}");
    Ok(())
}

// ── token ──────────────────────────────────────────────────

pub async fn token_list(
    project_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/projects/{project_id}/tokens",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["tokens"].as_array().cloned().unwrap_or_default();
    println!(
        "{:<38}  {:<7}  {:<6}  {:<24}  label",
        "id", "kind", "last4", "created"
    );
    for t in &rows {
        println!(
            "{:<38}  {:<7}  {:<6}  {:<24}  {}",
            t["id"].as_str().unwrap_or("?"),
            t["kind"].as_str().unwrap_or("?"),
            t["last4"].as_str().unwrap_or("—"),
            t["created_at"].as_str().unwrap_or("?"),
            t["label"].as_str().unwrap_or("—"),
        );
    }
    Ok(())
}

pub async fn token_mint(
    project_id: String,
    label: Option<String>,
    kind: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/projects/{project_id}/tokens",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c
        .post(&url)
        .json(&serde_json::json!({ "label": label, "kind": kind }))
        .send()
        .await?
        .error_for_status()?;
    let body: Value = resp.json().await?;
    println!("minted token {} ({})", body["token_id"], body["kind"]);
    println!();
    println!("  {}", body["token"].as_str().unwrap_or("?"));
    println!();
    println!("This is shown ONCE. Paste into SDK init({{ token, ingestUrl }}).");
    Ok(())
}

pub async fn token_revoke(
    token_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/admin/api/tokens/{token_id}", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("revoked token {token_id}");
    Ok(())
}

// ── audit ──────────────────────────────────────────────────

pub async fn audit_list(
    project_id: Option<String>,
    actor: Option<String>,
    action: Option<String>,
    limit: u32,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let mut url = format!("{}/v1/audit?limit={limit}", resolve_api_url(api_url));
    if let Some(p) = project_id {
        url.push_str(&format!("&project_id={p}"));
    }
    if let Some(a) = actor {
        url.push_str(&format!("&actor_user_id={a}"));
    }
    if let Some(act) = action {
        url.push_str(&format!("&action={act}"));
    }
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Vec<Value> = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!(
        "{:<24}  {:<28}  {:<10}  {:<10}",
        "when", "action", "actor", "project"
    );
    for e in &body {
        println!(
            "{:<24}  {:<28}  {:<10}  {:<10}",
            e["created_at"].as_str().unwrap_or("?"),
            e["action"].as_str().unwrap_or("?"),
            e["actor_user_id"]
                .as_str()
                .map(|s| &s[..s.len().min(8)])
                .unwrap_or("system"),
            e["project_id"]
                .as_str()
                .map(|s| &s[..s.len().min(8)])
                .unwrap_or("workspace"),
        );
    }
    Ok(())
}

// ── member ─────────────────────────────────────────────────

pub async fn member_list(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/admin/api/members", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["members"].as_array().cloned().unwrap_or_default();
    println!("{:<38}  {:<8}  added", "user_id", "role");
    for m in &rows {
        println!(
            "{:<38}  {:<8}  {}",
            m["user_id"].as_str().unwrap_or("?"),
            m["role"].as_str().unwrap_or("?"),
            m["added_at"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn member_remove(
    user_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/admin/api/members/{user_id}", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("removed member {user_id}");
    Ok(())
}

// ── invite ─────────────────────────────────────────────────

pub async fn invite_mint(
    email: String,
    role: String,
    invited_by: String,
    expires_in_days: i64,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/admin/api/invites", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c
        .post(&url)
        .json(&serde_json::json!({
            "email": email,
            "role": role,
            "invited_by": invited_by,
            "expires_in_days": expires_in_days,
        }))
        .send()
        .await?
        .error_for_status()?;
    let body: Value = resp.json().await?;
    println!(
        "invite {} for {} (role {}, expires {})",
        body["invite_id"],
        email,
        role,
        body["expires_at"].as_str().unwrap_or("?")
    );
    println!();
    println!("  {}", body["token"].as_str().unwrap_or("?"));
    println!();
    println!("Forward this token to {email} — they paste into /auth/invites/<token>/accept.");
    Ok(())
}

// ── alert ──────────────────────────────────────────────────

pub async fn alert_list(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/v1/alerts", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Vec<Value> = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!(
        "{:<38}  {:<6}  {:<32}  {:<6}  trigger",
        "id", "active", "name", "throttle"
    );
    for a in &body {
        println!(
            "{:<38}  {:<6}  {:<32}  {:<6}  {}",
            a["id"].as_str().unwrap_or("?"),
            if a["enabled"].as_bool().unwrap_or(true) {
                "on"
            } else {
                "off"
            },
            a["name"].as_str().unwrap_or("?"),
            a["throttle_minutes"].as_i64().unwrap_or(0),
            a["trigger_kind"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn alert_delete(
    alert_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/v1/alerts/{alert_id}", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("deleted alert {alert_id}");
    Ok(())
}

pub async fn alert_show(
    alert_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/v1/alerts/{alert_id}", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    println!("{}", serde_json::to_string_pretty(&body)?);
    Ok(())
}

// ── saved-view ─────────────────────────────────────────────

pub async fn view_list(
    target: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/saved-views?target={target}",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Vec<Value> = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!("{:<38}  {:<10}  {:<10}  name", "id", "target", "scope");
    for v in &body {
        println!(
            "{:<38}  {:<10}  {:<10}  {}",
            v["id"].as_str().unwrap_or("?"),
            v["target"].as_str().unwrap_or("?"),
            v["scope"].as_str().unwrap_or("?"),
            v["name"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn view_delete(
    view_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/v1/saved-views/{view_id}", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("deleted view {view_id}");
    Ok(())
}

// ── cert ───────────────────────────────────────────────────

pub async fn cert_list(
    project_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/projects/{project_id}/cert/observations",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Vec<Value> = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!(
        "{:<40}  {:<25}  expires",
        "domain", "issuer"
    );
    for o in &body {
        println!(
            "{:<40}  {:<25}  {}",
            o["domain"].as_str().unwrap_or("?"),
            o["issuer_name"]
                .as_str()
                .map(|s| &s[..s.len().min(25)])
                .unwrap_or("?"),
            o["not_after"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn cert_watch(
    project_id: String,
    domain: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/projects/{project_id}/cert/watches",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    c.post(&url)
        .json(&serde_json::json!({ "domain": domain }))
        .send()
        .await?
        .error_for_status()?;
    println!("now watching {domain}");
    Ok(())
}

pub async fn cert_unwatch(
    project_id: String,
    domain: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/projects/{project_id}/cert/watches/{domain}",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("stopped watching {domain}");
    Ok(())
}

// ── usage ──────────────────────────────────────────────────

pub async fn usage_show(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/v1/usage", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!(
        "plan: {}    status: {}    period: {}",
        body["plan"].as_str().unwrap_or("?"),
        body["status"].as_str().unwrap_or("?"),
        body["period_yyyymm"].as_str().unwrap_or("?"),
    );
    for key in ["events", "spans", "replays"] {
        let g = &body[key];
        let count = g["count"].as_i64().unwrap_or(0);
        let limit = g["limit"].as_i64().unwrap_or(0);
        let dropped = g["dropped"].as_i64().unwrap_or(0);
        println!(
            "  {:<8} {:>10} / {:>10}  dropped {:>6}",
            key, count, limit, dropped
        );
    }
    Ok(())
}

// ── stats ──────────────────────────────────────────────────

pub async fn trace_list(
    project_id: String,
    limit: u32,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/projects/{project_id}/traces?limit={limit}",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["traces"].as_array().cloned().unwrap_or_default();
    println!(
        "{:<38}  {:<10}  {:>8}  {:>6}  name",
        "trace_id", "root_op", "spans", "ms"
    );
    for t in &rows {
        println!(
            "{:<38}  {:<10}  {:>8}  {:>6}  {}",
            t["trace_id"].as_str().unwrap_or("?"),
            t["root_op"].as_str().unwrap_or("—"),
            t["span_count"].as_i64().unwrap_or(0),
            t["duration_ms"].as_i64().unwrap_or(0),
            t["root_name"].as_str().unwrap_or(""),
        );
    }
    Ok(())
}

pub async fn replay_list(
    project_id: String,
    limit: u32,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/projects/{project_id}/replays?limit={limit}",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["replays"].as_array().cloned().unwrap_or_default();
    println!(
        "{:<38}  {:>7}  {:>7}  event",
        "id", "ms", "frames"
    );
    for r in &rows {
        println!(
            "{:<38}  {:>7}  {:>7}  {}",
            r["id"].as_str().unwrap_or("?"),
            r["duration_ms"].as_i64().unwrap_or(0),
            r["frame_count"].as_i64().unwrap_or(0),
            r["event_id"]
                .as_str()
                .map(|s| &s[..s.len().min(8)])
                .unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn metric_list(
    project_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/projects/{project_id}/metrics",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["metrics"].as_array().cloned().unwrap_or_default();
    println!(
        "{:<40}  {:>10}  {:>10}  last",
        "name", "24h count", "avg"
    );
    for m in &rows {
        println!(
            "{:<40}  {:>10}  {:>10.2}  {}",
            m["name"].as_str().unwrap_or("?"),
            m["total_count"].as_i64().unwrap_or(0),
            m["avg_value"].as_f64().unwrap_or(0.0),
            m["last_bucket"].as_str().unwrap_or("—"),
        );
    }
    Ok(())
}

pub async fn comment_post(
    issue_id: String,
    body_md: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/issues/{issue_id}/comments",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c
        .post(&url)
        .json(&serde_json::json!({ "body_md": body_md }))
        .send()
        .await?
        .error_for_status()?;
    let body: Value = resp.json().await?;
    println!(
        "posted comment {} on issue {}",
        body["id"].as_str().unwrap_or("?"),
        body["issue_id"].as_str().unwrap_or("?"),
    );
    Ok(())
}

pub async fn comment_list(
    issue_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/issues/{issue_id}/comments",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["comments"].as_array().cloned().unwrap_or_default();
    for c in &rows {
        println!(
            "  [{}] {}",
            c["author_user_id"]
                .as_str()
                .map(|s| &s[..s.len().min(8)])
                .unwrap_or("?"),
            c["body_md"].as_str().unwrap_or("")
        );
    }
    Ok(())
}

pub async fn session_list(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/auth/sessions", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["sessions"].as_array().cloned().unwrap_or_default();
    println!("sessions: {}", rows.len());
    for s in &rows {
        println!(
            "  {}  expires {}  ip {}",
            s["id_hash_hex"]
                .as_str()
                .map(|h| &h[..h.len().min(12)])
                .unwrap_or("?"),
            s["expires_at"].as_str().unwrap_or("?"),
            s["ip"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn session_revoke(
    id_hash_hex: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/auth/sessions/{id_hash_hex}",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("revoked session {id_hash_hex}");
    Ok(())
}

pub async fn watcher_list(
    issue_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/issues/{issue_id}/watchers",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["watchers"].as_array().cloned().unwrap_or_default();
    println!("watchers: {}", rows.len());
    for w in &rows {
        println!(
            "  {} (since {})",
            w["user_id"]
                .as_str()
                .map(|s| &s[..s.len().min(8)])
                .unwrap_or("?"),
            w["started_at"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn unwatch_issue(
    issue_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/issues/{issue_id}/watchers",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    c.delete(&url).send().await?.error_for_status()?;
    println!("unwatched {issue_id}");
    Ok(())
}

pub async fn issue_watch(
    issue_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/issues/{issue_id}/watchers",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    c.post(&url)
        .json(&serde_json::json!({}))
        .send()
        .await?
        .error_for_status()?;
    println!("watching {issue_id}");
    Ok(())
}

pub async fn notification_list(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/auth/notifications", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!(
        "unread: {}",
        body["unread"].as_i64().unwrap_or(0)
    );
    let rows = body["notifications"].as_array().cloned().unwrap_or_default();
    for n in &rows {
        let read = n["read_at"].is_string();
        println!(
            "  {} [{}] {}",
            if read { "·" } else { "●" },
            n["kind"].as_str().unwrap_or("?"),
            n["created_at"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn notification_read_all(
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/auth/notifications/_read_all",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    c.post(&url)
        .json(&serde_json::json!({}))
        .send()
        .await?
        .error_for_status()?;
    println!("marked all read");
    Ok(())
}

pub async fn describe(api_url: Option<String>, json: bool) -> Result<()> {
    let url = format!("{}/v1/_describe", resolve_api_url(api_url));
    let c = reqwest::Client::new();
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!("server: {}", body["version"].as_str().unwrap_or("?"));
    println!("token prefix: {}", body["sdk_token_prefix"].as_str().unwrap_or("?"));
    println!("session cookie: {}", body["session_cookie"].as_str().unwrap_or("?"));
    if let Some(groups) = body["endpoints"].as_object() {
        for (group, list) in groups {
            let n = list.as_array().map(|a| a.len()).unwrap_or(0);
            println!("  {group:<15}  {n:>3} endpoints");
        }
    }
    Ok(())
}

pub async fn health_check(api_url: Option<String>) -> Result<()> {
    let url = format!("{}/healthz", resolve_api_url(api_url));
    // No auth needed
    let c = reqwest::Client::new();
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    println!(
        "status:  {}\ndb:      {}\nversion: {}",
        body["status"].as_str().unwrap_or("?"),
        body["db"].as_str().unwrap_or("?"),
        body["version"].as_str().unwrap_or("?"),
    );
    Ok(())
}

pub async fn me_show(
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/auth/me", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    println!(
        "user_id:        {}\nemail:          {}\nemail_verified: {}\ncreated_at:     {}",
        body["user_id"].as_str().unwrap_or("?"),
        body["email"].as_str().unwrap_or("?"),
        body["email_verified"].as_bool().unwrap_or(false),
        body["created_at"].as_str().unwrap_or("?"),
    );
    Ok(())
}

pub async fn live_tail(
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    use anyhow::anyhow;
    use std::io::{self, Write};
    let url = format!("{}/v1/events/_recent", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c
        .get(&url)
        .header("accept", "text/event-stream")
        .send()
        .await?
        .error_for_status()?;
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| anyhow!("stream: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(idx) = buf.find("\n\n") {
            let frame = buf[..idx].to_string();
            buf.drain(..idx + 2);
            for line in frame.lines() {
                if let Some(data) = line.strip_prefix("data:") {
                    let json: serde_json::Value = serde_json::from_str(data.trim())
                        .unwrap_or(serde_json::Value::Null);
                    println!(
                        "{}  {}  {}  {}  issue={}",
                        json["timestamp"].as_str().unwrap_or("?"),
                        json["kind"].as_str().unwrap_or("?"),
                        json["platform"].as_str().unwrap_or("?"),
                        json["release"].as_str().unwrap_or("?"),
                        json["issue_id"]
                            .as_str()
                            .map(|s| &s[..s.len().min(8)])
                            .unwrap_or("?"),
                    );
                    io::stdout().flush().ok();
                }
            }
        }
    }
    Ok(())
}

pub async fn release_list(
    project_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/projects/{project_id}/releases",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["releases"].as_array().cloned().unwrap_or_default();
    println!("{:<38}  deploy_at            name", "id");
    for r in &rows {
        println!(
            "{:<38}  {:<20}  {}",
            r["id"].as_str().unwrap_or("?"),
            r["deploy_at"].as_str().unwrap_or("—"),
            r["name"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn release_artifacts(
    project_id: String,
    release_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/admin/api/projects/{project_id}/releases/{release_id}/artifacts",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["artifacts"].as_array().cloned().unwrap_or_default();
    println!("{:<10}  {:>10}  hash             name", "kind", "size");
    for a in &rows {
        println!(
            "{:<10}  {:>10}  {:<14}  {}",
            a["kind"].as_str().unwrap_or("?"),
            a["size_bytes"].as_i64().unwrap_or(0),
            a["content_hash"]
                .as_str()
                .map(|s| &s[..s.len().min(14)])
                .unwrap_or("?"),
            a["name"].as_str().unwrap_or("?"),
        );
    }
    Ok(())
}

pub async fn push_send(
    native_tokens: Vec<String>,
    title: String,
    body_text: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!("{}/v1/push/send", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c
        .post(&url)
        .json(&serde_json::json!({
            "nativeTokens": native_tokens,
            "payload": { "title": title, "body": body_text },
        }))
        .send()
        .await?
        .error_for_status()?;
    let body: Value = resp.json().await?;
    println!(
        "queued {} push(es): {}",
        body["queued"].as_i64().unwrap_or(0),
        serde_json::to_string(&body["send_ids"])?,
    );
    Ok(())
}

pub async fn replay_download(
    project_id: String,
    replay_id: String,
    token: Option<String>,
    api_url: Option<String>,
) -> Result<()> {
    let url = format!(
        "{}/v1/projects/{project_id}/replays/{replay_id}/ndjson",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let bytes = c.get(&url).send().await?.error_for_status()?.bytes().await?;
    // Print raw NDJSON to stdout — pipe to file: > replay.ndjson
    use std::io::Write;
    std::io::stdout().write_all(&bytes)?;
    Ok(())
}

pub async fn search_project(
    project_id: String,
    query: String,
    limit: u32,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    // Minimal manual encode: replace unsafe chars. Good enough
    // for typical search terms (alphanumerics + spaces + dots).
    let encoded = query
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                c.to_string()
            }
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect::<String>();
    let url = format!(
        "{}/v1/projects/{project_id}/search?q={encoded}&limit={limit}",
        resolve_api_url(api_url),
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let issues = body["issues"].as_array().cloned().unwrap_or_default();
    let events = body["events"].as_array().cloned().unwrap_or_default();
    if !issues.is_empty() {
        println!("── Issues ──");
        for i in &issues {
            println!(
                "  [{}] {} — {}",
                i["status"].as_str().unwrap_or("?"),
                i["error_type"].as_str().unwrap_or("?"),
                i["message_sample"]
                    .as_str()
                    .map(|s| &s[..s.len().min(60)])
                    .unwrap_or(""),
            );
        }
    }
    if !events.is_empty() {
        println!("── Events ──");
        for e in &events {
            println!(
                "  {} {} {} {}",
                e["timestamp"].as_str().unwrap_or("?"),
                e["kind"].as_str().unwrap_or("?"),
                e["release"].as_str().unwrap_or("?"),
                e["environment"].as_str().unwrap_or("?"),
            );
        }
    }
    Ok(())
}

pub async fn stats_show(
    project_id: String,
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/v1/projects/{project_id}/stats",
        resolve_api_url(api_url)
    );
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    println!("project {project_id}");
    println!(
        "  events 24h:    {:>10}",
        body["events_24h"].as_i64().unwrap_or(0)
    );
    println!(
        "  issues active: {:>10}",
        body["issues_active"].as_i64().unwrap_or(0)
    );
    println!(
        "  spans 24h:     {:>10}",
        body["spans_24h"].as_i64().unwrap_or(0)
    );
    println!(
        "  metrics 24h:   {:>10}  (buckets)",
        body["metrics_buckets_24h"].as_i64().unwrap_or(0)
    );
    println!(
        "  replays 24h:   {:>10}",
        body["replays_24h"].as_i64().unwrap_or(0)
    );
    Ok(())
}

pub async fn invite_list(
    token: Option<String>,
    api_url: Option<String>,
    json: bool,
) -> Result<()> {
    let url = format!("{}/admin/api/invites", resolve_api_url(api_url));
    let c = client(&token_value(token)?)?;
    let resp = c.get(&url).send().await?.error_for_status()?;
    let body: Value = resp.json().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&body)?);
        return Ok(());
    }
    let rows = body["invites"].as_array().cloned().unwrap_or_default();
    println!("{:<38}  {:<28}  {:<6}  status", "id", "email", "role");
    for i in &rows {
        let accepted = !i["accepted_at"].is_null();
        let status = if accepted { "accepted" } else { "pending" };
        println!(
            "{:<38}  {:<28}  {:<6}  {}",
            i["id"].as_str().unwrap_or("?"),
            i["email"].as_str().unwrap_or("?"),
            i["role"].as_str().unwrap_or("?"),
            status,
        );
    }
    Ok(())
}
