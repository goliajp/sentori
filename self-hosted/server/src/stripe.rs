//! Stripe integration — config, webhook ingest, and the two
//! self-serve billing round-trips (Checkout + Portal).
//!
//! Cement-tier glue: it knows the Sentori billing domain (plans,
//! workspaces) AND talks to a specific external vendor. The pure
//! HMAC signature check lives in the `stripe-webhook-verify` stone;
//! everything commercial (price ids, plan mapping, API shapes)
//! lives here where it can churn without touching a stone.
//!
//! All commercial parameters come from the environment — this file
//! hard-codes no price ids, amounts, or product names.
//!
//! - `SENTORI_STRIPE_SECRET_KEY` — `sk_…`, used as Bearer for the
//!   REST API.
//! - `SENTORI_STRIPE_WEBHOOK_SECRET` — `whsec_…`, HMAC key for inbound
//!   webhook verification.
//! - `SENTORI_STRIPE_PRICE_PRO` — `price_…` for the Pro plan.
//! - `SENTORI_STRIPE_PRICE_ENTERPRISE` — `price_…` for Enterprise
//!   (optional; usually sales-led).
//! - `SENTORI_PUBLIC_URL` — dashboard origin for the Checkout / Portal
//!   return URLs.

use sentori_billing::Plan;
use sentori_stripe_webhook_verify::{Tolerance, verify};
use sqlx::PgPool;
use uuid::Uuid;

const STRIPE_API_BASE: &str = "https://api.stripe.com";

/// Env-driven Stripe configuration. Cloned into every handler that
/// needs it (all fields are small owned strings).
#[derive(Clone, Debug, Default)]
pub struct StripeConfig {
    pub secret_key: Option<String>,
    pub webhook_secret: Option<String>,
    pub price_pro: Option<String>,
    pub price_enterprise: Option<String>,
    /// Dashboard origin, e.g. `https://sentori.golia.jp`. Checkout
    /// success/cancel + Portal return URLs are built off it.
    pub public_url: String,
}

impl StripeConfig {
    /// Read every parameter from the environment. Absent keys leave
    /// their `Option` `None`, which disables the corresponding path
    /// (a deployment with no `secret_key` simply has no self-serve
    /// billing — the endpoints answer 503).
    #[must_use]
    pub fn from_env() -> Self {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Self {
            secret_key: env("SENTORI_STRIPE_SECRET_KEY"),
            webhook_secret: env("SENTORI_STRIPE_WEBHOOK_SECRET"),
            price_pro: env("SENTORI_STRIPE_PRICE_PRO"),
            price_enterprise: env("SENTORI_STRIPE_PRICE_ENTERPRISE"),
            public_url: env("SENTORI_PUBLIC_URL")
                .unwrap_or_else(|| "https://sentori.golia.jp".to_string()),
        }
    }

    /// The Stripe price id configured for `plan`, if any. `Free`
    /// has no price (it is the absence of a subscription).
    #[must_use]
    pub fn price_for_plan(&self, plan: Plan) -> Option<&str> {
        match plan {
            Plan::Free => None,
            Plan::Pro => self.price_pro.as_deref(),
            Plan::Enterprise => self.price_enterprise.as_deref(),
        }
    }

    /// Reverse map: which plan a Stripe price id sells. Used by the
    /// webhook worker to translate a subscription's price back into
    /// a Sentori plan. Unknown prices return `None` (worker marks
    /// the event failed rather than guessing).
    #[must_use]
    pub fn plan_for_price(&self, price_id: &str) -> Option<Plan> {
        if self.price_pro.as_deref() == Some(price_id) {
            Some(Plan::Pro)
        } else if self.price_enterprise.as_deref() == Some(price_id) {
            Some(Plan::Enterprise)
        } else {
            None
        }
    }
}

/// Verify + persist one Stripe webhook delivery into the
/// `stripe_events` ledger. Returns `Ok(true)` when newly recorded,
/// `Ok(false)` when the event id was already seen (dedup hit — the
/// caller still answers 200 so Stripe stops retrying).
///
/// Ported from the retired `sentori-saas-control` binary; the
/// billing control plane now lives in `sentori-server` against the
/// shared DB (migration 0034).
///
/// # Errors
///
/// - Signature verification failure (caller responds 400; the row
///   is NOT persisted on a bad signature).
/// - JSON / DB errors bubble up.
pub async fn ingest_webhook(
    pool: &PgPool,
    body: &[u8],
    sig_header: &str,
    secret: &str,
    now_unix: i64,
) -> anyhow::Result<bool> {
    verify(
        secret.as_bytes(),
        sig_header,
        body,
        now_unix,
        Tolerance::default(),
    )
    .map_err(|e| anyhow::anyhow!("stripe sig verify: {e}"))?;

    let payload: serde_json::Value = serde_json::from_slice(body)
        .map_err(|e| anyhow::anyhow!("malformed Stripe payload JSON: {e}"))?;
    let stripe_event_id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Stripe event payload missing `id`"))?;
    let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

    let inserted: Option<(Uuid,)> = sqlx::query_as(
        r"
        INSERT INTO stripe_events (id, stripe_event_id, event_type, payload)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING id
        ",
    )
    .bind(Uuid::now_v7())
    .bind(stripe_event_id)
    .bind(event_type)
    .bind(&payload)
    .fetch_optional(pool)
    .await?;
    Ok(inserted.is_some())
}

/// Create a Stripe Checkout Session for a subscription and return
/// its hosted `url` (the caller 302s / hands it to the browser).
///
/// `client_reference_id = workspace_id` is the thread that lets the
/// `checkout.session.completed` webhook map the payment back to a
/// Sentori workspace. When the workspace already has a Stripe
/// customer we pass it so the subscription attaches to the existing
/// customer; otherwise Stripe creates one (surfaced later via the
/// webhook's `customer` field).
///
/// # Errors
///
/// Network / non-2xx Stripe responses, or a response missing `url`.
pub async fn create_checkout_session(
    cfg: &StripeConfig,
    workspace_id: Uuid,
    customer_id: Option<&str>,
    customer_email: Option<&str>,
    price_id: &str,
) -> anyhow::Result<String> {
    let secret = cfg
        .secret_key
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("SENTORI_STRIPE_SECRET_KEY not configured"))?;
    let ws = workspace_id.to_string();
    let success_url = format!("{}/settings/billing?checkout=success", cfg.public_url);
    let cancel_url = format!("{}/settings/billing?checkout=cancel", cfg.public_url);

    let mut form: Vec<(&str, &str)> = vec![
        ("mode", "subscription"),
        ("line_items[0][price]", price_id),
        ("line_items[0][quantity]", "1"),
        ("client_reference_id", ws.as_str()),
        ("success_url", success_url.as_str()),
        ("cancel_url", cancel_url.as_str()),
        // Mirror the workspace id into subscription metadata too, so
        // later subscription.* events (which carry no
        // client_reference_id) can still be mapped back.
        ("subscription_data[metadata][workspace_id]", ws.as_str()),
    ];
    // Reuse an existing customer when we have one, else let Stripe
    // create it and prefill the email.
    if let Some(cid) = customer_id {
        form.push(("customer", cid));
    } else if let Some(email) = customer_email {
        form.push(("customer_email", email));
    }

    let resp = reqwest::Client::new()
        .post(format!("{STRIPE_API_BASE}/v1/checkout/sessions"))
        .bearer_auth(secret)
        .form(&form)
        .send()
        .await?;
    let json = parse_stripe_response(resp, "checkout session").await?;
    json.get("url")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("Stripe checkout session response missing `url`"))
}

/// Create a Billing Portal session for an existing customer and
/// return its hosted `url`. The Portal is where the customer
/// updates card / cancels / views invoices — Stripe hosts the UI.
///
/// # Errors
///
/// Network / non-2xx Stripe responses, or a response missing `url`.
pub async fn create_portal_session(
    cfg: &StripeConfig,
    customer_id: &str,
) -> anyhow::Result<String> {
    let secret = cfg
        .secret_key
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("SENTORI_STRIPE_SECRET_KEY not configured"))?;
    let return_url = format!("{}/settings/billing", cfg.public_url);
    let form: Vec<(&str, &str)> = vec![("customer", customer_id), ("return_url", &return_url)];

    let resp = reqwest::Client::new()
        .post(format!("{STRIPE_API_BASE}/v1/billing_portal/sessions"))
        .bearer_auth(secret)
        .form(&form)
        .send()
        .await?;
    let json = parse_stripe_response(resp, "billing portal session").await?;
    json.get("url")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("Stripe portal session response missing `url`"))
}

/// Turn a Stripe HTTP response into JSON, surfacing a non-2xx as a
/// readable error (Stripe puts the human message under
/// `error.message`).
async fn parse_stripe_response(
    resp: reqwest::Response,
    what: &str,
) -> anyhow::Result<serde_json::Value> {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("(no error message)");
        anyhow::bail!("Stripe {what} failed ({status}): {msg}");
    }
    Ok(body)
}
