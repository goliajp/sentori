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
