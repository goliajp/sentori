// Phase 43 sub-E — Slack adapter via incoming-webhook URL.
//
// Why not OAuth: Slack's full OAuth flow + the chat:write scope
// requires app distribution review, redirect URLs registered per
// workspace, etc. Incoming Webhooks (workspace-scoped, the user
// generates the URL inside Slack's app config) is the simpler
// path and matches what most teams already do for Sentry / DataDog
// alerts.
//
// `config` JSONB shape:
//   { "webhookUrl": "https://hooks.slack.com/services/T…/B…/…",
//     "channelLabel": "#sentori-alerts"  (user-supplied display label) }
//
// The webhookUrl IS the credential — anyone who has it can post
// into that channel. We treat it the same as an OAuth access
// token: never echoed back through `list_integrations`, only
// `channelLabel` surfaces on the dashboard.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    ConnectMode, ExternalRef, IntegrationAdapter, IntegrationError, IssueContext,
    IssueLifecycleEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackConfig {
    pub webhook_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_label: Option<String>,
}

pub struct SlackAdapter;

impl SlackAdapter {
    /// Slack adapter has no env-var gate today — every self-hosted
    /// Sentori can connect a Slack workspace via incoming webhook.
    /// Future tightening (per-tenant flag) can use a new env var.
    pub fn new() -> Self {
        Self
    }
}

impl Default for SlackAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl IntegrationAdapter for SlackAdapter {
    fn kind(&self) -> &'static str {
        "slack"
    }

    fn is_configured(&self) -> bool {
        // Adapter itself is always available; the per-org config row
        // is what proves a workspace is connected.
        true
    }

    fn connect_mode(&self) -> ConnectMode {
        ConnectMode::Manual
    }

    fn oauth_authorise_url(&self, _state: &str, _redirect_uri: &str) -> String {
        String::new() // not used; connect_mode is Manual
    }

    async fn exchange_code(
        &self,
        _code: &str,
        _redirect_uri: &str,
    ) -> Result<Value, IntegrationError> {
        Err(IntegrationError::OAuth(
            "Slack uses manual config — POST /admin/api/integrations/slack/configure".into(),
        ))
    }

    async fn accept_manual_config(&self, form: Value) -> Result<Value, IntegrationError> {
        let url = form
            .get("webhookUrl")
            .and_then(|v| v.as_str())
            .ok_or_else(|| IntegrationError::Upstream("webhookUrl required".into()))?
            .trim()
            .to_string();
        // Slack incoming-webhook URLs are always under hooks.slack.com.
        if !url.starts_with("https://hooks.slack.com/") {
            return Err(IntegrationError::Upstream(
                "webhookUrl must be a https://hooks.slack.com/… URL".into(),
            ));
        }
        let channel_label = form
            .get("channelLabel")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let cfg = SlackConfig {
            webhook_url: url,
            channel_label,
        };
        Ok(serde_json::to_value(cfg).expect("SlackConfig serializes"))
    }

    async fn create_issue(
        &self,
        config: &Value,
        ctx: &IssueContext,
    ) -> Result<ExternalRef, IntegrationError> {
        let cfg: SlackConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("bad config: {e}")))?;
        let payload = block_kit_new_issue(ctx);
        post_block_kit(&cfg.webhook_url, &payload).await?;
        // Slack incoming-webhook doesn't return a stable message ts
        // we can address later — there's no per-message id. We
        // synthesize an `external_id` from issue_id so the link
        // row exists (sub-B uses PK (issue_id, kind)). For
        // update_status we resend a new message; no edit-in-place.
        Ok(ExternalRef {
            external_id: ctx.issue_id.to_string(),
            external_url: ctx.url.clone(),
        })
    }

    async fn update_status(
        &self,
        config: &Value,
        _external_id: &str,
        event: IssueLifecycleEvent,
    ) -> Result<(), IntegrationError> {
        let cfg: SlackConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("bad config: {e}")))?;
        let payload = match event {
            IssueLifecycleEvent::Resolved => block_kit_status("resolved", "Resolved in Sentori."),
            IssueLifecycleEvent::Regressed => {
                block_kit_status("regressed", "Regressed in Sentori — re-opening.")
            }
            IssueLifecycleEvent::Created => return Ok(()), // create path posted already
        };
        post_block_kit(&cfg.webhook_url, &payload).await
    }
}

// ───────────────────── Block Kit templates ──────────────────────────

fn block_kit_new_issue(ctx: &IssueContext) -> Value {
    let title = format!("{}: {}", ctx.error_type, truncate(&ctx.error_message, 140));
    json!({
        "text": title,
        "blocks": [
            {
                "type": "header",
                "text": { "type": "plain_text", "text": "New Sentori issue" }
            },
            {
                "type": "section",
                "text": { "type": "mrkdwn", "text": format!("*<{}|{}>*", ctx.url, escape(&title)) }
            },
            {
                "type": "context",
                "elements": [
                    { "type": "mrkdwn", "text": format!("`{}`", ctx.release) },
                    { "type": "mrkdwn", "text": format!("env `{}`", ctx.environment) },
                    { "type": "mrkdwn", "text": format!("events: {}", ctx.event_count) },
                ]
            }
        ]
    })
}

fn block_kit_status(badge: &str, body: &str) -> Value {
    let emoji = match badge {
        "resolved" => ":white_check_mark:",
        "regressed" => ":warning:",
        _ => ":memo:",
    };
    json!({
        "text": body,
        "blocks": [
            { "type": "section", "text": { "type": "mrkdwn", "text": format!("{emoji} {body}") } }
        ]
    })
}

fn escape(s: &str) -> String {
    // Slack mrkdwn requires `<`, `>`, `&` escaping.
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect::<String>() + "…"
}

async fn post_block_kit(webhook_url: &str, payload: &Value) -> Result<(), IntegrationError> {
    let resp = reqwest::Client::new()
        .post(webhook_url)
        .json(payload)
        .send()
        .await
        .map_err(|e| IntegrationError::Upstream(format!("slack post: {e}")))?;
    if !resp.status().is_success() {
        return Err(IntegrationError::Upstream(format!(
            "slack {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn accept_manual_config_validates_webhook_url() {
        let a = SlackAdapter::new();
        // Missing webhookUrl
        let r = a.accept_manual_config(json!({})).await;
        assert!(r.is_err());
        // Wrong scheme / host
        let r = a
            .accept_manual_config(json!({ "webhookUrl": "https://example.com/x" }))
            .await;
        assert!(r.is_err());
        // Good URL
        let cfg = a
            .accept_manual_config(json!({
                "webhookUrl": "https://hooks.slack.com/services/T/B/X",
                "channelLabel": "#alerts"
            }))
            .await
            .expect("valid");
        let parsed: SlackConfig = serde_json::from_value(cfg).expect("decode");
        assert_eq!(parsed.webhook_url, "https://hooks.slack.com/services/T/B/X");
        assert_eq!(parsed.channel_label.as_deref(), Some("#alerts"));
    }

    fn ctx() -> IssueContext {
        IssueContext {
            issue_id: Uuid::nil(),
            project_id: Uuid::nil(),
            error_type: "TypeError".into(),
            error_message: "boom".into(),
            release: "app@1.0+1".into(),
            environment: "prod".into(),
            url: "https://app/issues/x".into(),
            event_count: 5,
            crash_site: None,
        }
    }

    #[test]
    fn block_kit_new_issue_contains_title_link_and_meta() {
        let payload = block_kit_new_issue(&ctx());
        let s = payload.to_string();
        assert!(s.contains("TypeError: boom"));
        assert!(s.contains("https://app/issues/x"));
        assert!(s.contains("app@1.0+1"));
        assert!(s.contains("env `prod`"));
        assert!(s.contains("events: 5"));
    }

    #[test]
    fn block_kit_status_uses_emoji_per_badge() {
        let p = block_kit_status("resolved", "ok").to_string();
        assert!(p.contains(":white_check_mark:"));
        let p = block_kit_status("regressed", "back").to_string();
        assert!(p.contains(":warning:"));
    }
}
