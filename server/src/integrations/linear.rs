// Phase 43 sub-A.04 — Linear adapter.
//
// OAuth flow:
//   GET  /admin/api/integrations/linear/connect?orgId=...
//     → server mints `state`, stores in Valkey for 10 min, returns
//       302 → `https://linear.app/oauth/authorize?...`
//   GET  /admin/api/integrations/linear/callback?code=...&state=...
//     → server validates state, POSTs to Linear token endpoint,
//       upserts into `integrations` table, 302 → dashboard.
//
// Issue creation:
//   - GraphQL mutation `issueCreate(input: { teamId, title,
//     description })`. The `teamId` comes from the adapter config
//     (set during `connect` after we list the user's teams via
//     `teams` query). For the first cut we just stash the OAuth
//     access token + workspace id + first team we see.
//   - `issuePriority` / labels / assignee left to a follow-up.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{ExternalRef, IntegrationAdapter, IntegrationError, IssueContext, IssueLifecycleEvent};

const LINEAR_OAUTH_AUTHORIZE_URL: &str = "https://linear.app/oauth/authorize";
const LINEAR_OAUTH_TOKEN_URL: &str = "https://api.linear.app/oauth/token";
const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";

/// Persisted config — what we store in `integrations.config`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearConfig {
    pub access_token: String,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    /// Team the adapter routes new issues to. Picked during
    /// `connect` via `teams { nodes { id, name } }`; for v0.7 we
    /// take the first team. A future sub-phase exposes a picker.
    pub default_team_id: Option<String>,
    pub default_team_name: Option<String>,
}

pub struct LinearAdapter {
    pub client_id: String,
    pub client_secret: String,
}

impl LinearAdapter {
    /// Read `SENTORI_LINEAR_CLIENT_ID` / `SENTORI_LINEAR_CLIENT_SECRET`.
    /// Returns `None` when either is missing (= integration disabled).
    pub fn from_env() -> Option<Self> {
        let id = std::env::var("SENTORI_LINEAR_CLIENT_ID").ok()?;
        let secret = std::env::var("SENTORI_LINEAR_CLIENT_SECRET").ok()?;
        if id.is_empty() || secret.is_empty() {
            return None;
        }
        Some(Self {
            client_id: id,
            client_secret: secret,
        })
    }
}

#[async_trait]
impl IntegrationAdapter for LinearAdapter {
    fn kind(&self) -> &'static str {
        "linear"
    }

    fn is_configured(&self) -> bool {
        !self.client_id.is_empty() && !self.client_secret.is_empty()
    }

    fn oauth_authorise_url(&self, state: &str, redirect_uri: &str) -> String {
        // Linear's required scopes for read + create issues +
        // webhook delivery on issue updates.
        let scopes = "read,write";
        format!(
            "{LINEAR_OAUTH_AUTHORIZE_URL}?response_type=code&client_id={cid}&redirect_uri={redir}&scope={scopes}&state={state}",
            cid = urlencoding::encode(&self.client_id),
            redir = urlencoding::encode(redirect_uri),
            scopes = urlencoding::encode(scopes),
            state = urlencoding::encode(state),
        )
    }

    async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<serde_json::Value, IntegrationError> {
        let client = reqwest::Client::new();
        let resp = client
            .post(LINEAR_OAUTH_TOKEN_URL)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
            ])
            .send()
            .await
            .map_err(|e| IntegrationError::OAuth(format!("token exchange request: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(IntegrationError::OAuth(format!(
                "token exchange returned {status}: {body}"
            )));
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "snake_case")]
        struct TokenResp {
            access_token: String,
        }
        let token: TokenResp = resp
            .json()
            .await
            .map_err(|e| IntegrationError::OAuth(format!("decode token response: {e}")))?;

        // Hit the GraphQL `viewer` + `teams` query so we can pre-fill
        // workspace_id + default_team_id; both are stashed in config
        // for later `issueCreate` calls.
        let (workspace, team) = fetch_workspace_and_team(&token.access_token).await?;

        let mut cfg = LinearConfig {
            access_token: token.access_token,
            workspace_id: None,
            workspace_name: None,
            default_team_id: None,
            default_team_name: None,
        };
        if let Some((wid, wname)) = workspace {
            cfg.workspace_id = Some(wid);
            cfg.workspace_name = Some(wname);
        }
        if let Some((tid, tname)) = team {
            cfg.default_team_id = Some(tid);
            cfg.default_team_name = Some(tname);
        }
        serde_json::to_value(cfg)
            .map_err(|e| IntegrationError::OAuth(format!("serialise config: {e}")))
    }

    async fn create_issue(
        &self,
        config: &serde_json::Value,
        ctx: &IssueContext,
    ) -> Result<ExternalRef, IntegrationError> {
        let cfg: LinearConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("bad config: {e}")))?;
        let Some(team_id) = cfg.default_team_id.as_deref() else {
            return Err(IntegrationError::Upstream(
                "no default team id configured".into(),
            ));
        };

        let title = format!("{}: {}", ctx.error_type, truncate(&ctx.error_message, 200));
        let description = build_description(ctx);

        let query = r#"
            mutation IssueCreate($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue {
                  id
                  identifier
                  url
                }
              }
            }
        "#;
        let body = json!({
            "query": query,
            "variables": {
                "input": {
                    "teamId": team_id,
                    "title": title,
                    "description": description,
                }
            }
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(LINEAR_GRAPHQL_URL)
            .header("Authorization", format!("Bearer {}", cfg.access_token))
            .json(&body)
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(format!("issueCreate request: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(IntegrationError::Upstream(format!(
                "issueCreate {status}: {body}"
            )));
        }

        #[derive(Deserialize)]
        struct GqlResp {
            data: Option<IssueCreateData>,
            errors: Option<serde_json::Value>,
        }
        #[derive(Deserialize)]
        struct IssueCreateData {
            #[serde(rename = "issueCreate")]
            issue_create: IssueCreateInner,
        }
        #[derive(Deserialize)]
        struct IssueCreateInner {
            success: bool,
            issue: Option<LinearIssue>,
        }
        #[derive(Deserialize)]
        struct LinearIssue {
            id: String,
            url: String,
        }
        let parsed: GqlResp = resp
            .json()
            .await
            .map_err(|e| IntegrationError::Upstream(format!("decode issueCreate: {e}")))?;
        if let Some(errs) = parsed.errors {
            return Err(IntegrationError::Upstream(format!(
                "linear graphql errors: {errs}"
            )));
        }
        let Some(data) = parsed.data else {
            return Err(IntegrationError::Upstream(
                "issueCreate returned no data".into(),
            ));
        };
        if !data.issue_create.success {
            return Err(IntegrationError::Upstream(
                "issueCreate success=false".into(),
            ));
        }
        let Some(issue) = data.issue_create.issue else {
            return Err(IntegrationError::Upstream(
                "issueCreate returned no issue".into(),
            ));
        };
        Ok(ExternalRef {
            external_id: issue.id,
            external_url: issue.url,
        })
    }

    async fn update_status(
        &self,
        config: &serde_json::Value,
        external_id: &str,
        event: IssueLifecycleEvent,
    ) -> Result<(), IntegrationError> {
        let cfg: LinearConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("bad config: {e}")))?;

        let comment_body = match event {
            IssueLifecycleEvent::Resolved => "Resolved in Sentori.",
            IssueLifecycleEvent::Regressed => "Regressed in Sentori — re-opening.",
            IssueLifecycleEvent::Created => return Ok(()), // create path handles this
        };

        // For v0.7 sub-A: drop a comment on the Linear issue. Full
        // state transition (e.g. workflowState change) is more
        // delicate (per-team state IDs vary) and lands in sub-D.
        let query = r#"
            mutation Comment($issueId: String!, $body: String!) {
              commentCreate(input: { issueId: $issueId, body: $body }) {
                success
              }
            }
        "#;
        let body = json!({
            "query": query,
            "variables": { "issueId": external_id, "body": comment_body }
        });
        let client = reqwest::Client::new();
        let resp = client
            .post(LINEAR_GRAPHQL_URL)
            .header("Authorization", format!("Bearer {}", cfg.access_token))
            .json(&body)
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(format!("comment request: {e}")))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "comment {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            )));
        }
        Ok(())
    }
}

// ────────────────────────────── helpers ──────────────────────────────

async fn fetch_workspace_and_team(
    access_token: &str,
) -> Result<(Option<(String, String)>, Option<(String, String)>), IntegrationError> {
    let query = r#"
        query Bootstrap {
          viewer {
            organization { id name }
          }
          teams(first: 1) { nodes { id name } }
        }
    "#;
    let body = json!({ "query": query });
    let resp = reqwest::Client::new()
        .post(LINEAR_GRAPHQL_URL)
        .header("Authorization", format!("Bearer {access_token}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| IntegrationError::OAuth(format!("bootstrap request: {e}")))?;
    if !resp.status().is_success() {
        return Err(IntegrationError::OAuth(format!(
            "bootstrap returned {}",
            resp.status()
        )));
    }
    #[derive(Deserialize)]
    struct Bootstrap {
        data: BootstrapData,
    }
    #[derive(Deserialize)]
    struct BootstrapData {
        viewer: Option<Viewer>,
        teams: Option<Teams>,
    }
    #[derive(Deserialize)]
    struct Viewer {
        organization: Option<Workspace>,
    }
    #[derive(Deserialize)]
    struct Workspace {
        id: String,
        name: String,
    }
    #[derive(Deserialize)]
    struct Teams {
        nodes: Vec<Team>,
    }
    #[derive(Deserialize)]
    struct Team {
        id: String,
        name: String,
    }
    let parsed: Bootstrap = resp
        .json()
        .await
        .map_err(|e| IntegrationError::OAuth(format!("decode bootstrap: {e}")))?;
    let workspace = parsed
        .data
        .viewer
        .and_then(|v| v.organization)
        .map(|w| (w.id, w.name));
    let team = parsed
        .data
        .teams
        .and_then(|t| t.nodes.into_iter().next())
        .map(|t| (t.id, t.name));
    Ok((workspace, team))
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect::<String>() + "…"
}

fn build_description(ctx: &IssueContext) -> String {
    let mut out = String::new();
    out.push_str("**Sentori issue**: ");
    out.push_str(&ctx.url);
    out.push_str("\n\n");
    out.push_str(&format!("**Release**: `{}`\n", ctx.release));
    out.push_str(&format!("**Environment**: `{}`\n", ctx.environment));
    out.push_str(&format!("**Event count**: {}\n", ctx.event_count));
    if let Some(site) = &ctx.crash_site {
        out.push_str(&format!("**Crash site**: `{site}`\n"));
    }
    out.push_str(&format!("\n```\n{}: {}\n```\n", ctx.error_type, ctx.error_message));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_authorise_url_has_required_params() {
        let a = LinearAdapter {
            client_id: "cid".into(),
            client_secret: "sec".into(),
        };
        let url = a.oauth_authorise_url("abc", "https://app/cb");
        assert!(url.contains("client_id=cid"));
        assert!(url.contains("state=abc"));
        assert!(url.contains("scope=read%2Cwrite"));
        assert!(url.starts_with("https://linear.app/oauth/authorize?"));
    }

    #[test]
    fn truncate_keeps_short_strings_intact() {
        assert_eq!(truncate("hi", 10), "hi");
        assert_eq!(truncate("hello world", 5), "hello…");
    }

    #[test]
    fn build_description_includes_all_meta() {
        let ctx = IssueContext {
            issue_id: uuid::Uuid::nil(),
            project_id: uuid::Uuid::nil(),
            error_type: "TypeError".into(),
            error_message: "boom".into(),
            release: "app@1.0+1".into(),
            environment: "prod".into(),
            url: "https://app/issues/x".into(),
            event_count: 42,
            crash_site: Some("src/Foo.tsx:18".into()),
        };
        let d = build_description(&ctx);
        assert!(d.contains("https://app/issues/x"));
        assert!(d.contains("app@1.0+1"));
        assert!(d.contains("src/Foo.tsx:18"));
        assert!(d.contains("TypeError: boom"));
    }
}
