// v0.9.3 +S3 — culprit commit tracking.
//
// MVP: manual mode. Dashboard user gives us a commit SHA they think
// introduced the issue; we fetch its metadata from GitHub (public
// repos, unauthenticated 60/hr — enough for manual ops), persist,
// and surface in the issue detail. Auto-detection (PAT-based git
// history sync + path-relevance scoring) lands in v1.0.
//
// Endpoints (all admin, scoped to project):
//   GET    /admin/api/projects/{id}/issues/{issue_id}/culprits
//   POST   /admin/api/projects/{id}/issues/{issue_id}/culprits
//          body: { commitSha: string }
//   DELETE /admin/api/projects/{id}/issues/{issue_id}/culprits/{culprit_id}

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CulpritRow {
    pub id: Uuid,
    pub commit_sha: String,
    pub author: Option<String>,
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", with = "time::serde::rfc3339::option")]
    pub committed_at: Option<OffsetDateTime>,
    pub html_url: Option<String>,
    pub confidence: i32,
    pub source: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(axum::Json(Vec::<CulpritRow>::new()).into_response());
    };
    let rows: Vec<(
        Uuid,
        String,
        Option<String>,
        Option<String>,
        Option<OffsetDateTime>,
        Option<String>,
        i32,
        String,
        OffsetDateTime,
    )> = sqlx::query_as(
        "SELECT id, commit_sha, author, message, committed_at, html_url, \
                confidence, source, created_at \
         FROM culprit_commits \
         WHERE project_id = $1 AND issue_id = $2 \
         ORDER BY confidence DESC, created_at DESC LIMIT 10",
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let out: Vec<CulpritRow> = rows
        .into_iter()
        .map(
            |(
                id,
                commit_sha,
                author,
                message,
                committed_at,
                html_url,
                confidence,
                source,
                created_at,
            )| CulpritRow {
                id,
                commit_sha,
                author,
                message,
                committed_at,
                html_url,
                confidence,
                source,
                created_at,
            },
        )
        .collect();
    Ok(axum::Json(out).into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachRequest {
    pub commit_sha: String,
}

pub async fn attach(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AttachRequest>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };

    let sha = req.commit_sha.trim();
    if sha.len() < 7 || sha.len() > 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Internal("invalid commit sha".into()));
    }

    // Pull source_repo_url from the project so we know where to ask
    // GitHub. If unset → reject, since we have nowhere to fetch from.
    let repo_url: Option<String> = sqlx::query_scalar(
        "SELECT source_repo_url FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .flatten();
    let Some(repo_url) = repo_url else {
        return Err(AppError::Internal(
            "project.source_repo_url is not configured".into(),
        ));
    };
    let (owner, repo) = parse_github(&repo_url)
        .ok_or_else(|| AppError::Internal("source_repo_url is not a GitHub URL".into()))?;

    // Fetch commit metadata from GitHub. Unauthenticated — 60 / hr
    // per server IP. Auto path in v1.0 will use a per-project PAT.
    let meta = fetch_github_commit(&owner, &repo, sha).await;
    let (author, message, committed_at, html_url) = match meta {
        Ok(m) => (Some(m.author), Some(m.message), Some(m.committed_at), Some(m.html_url)),
        Err(e) => {
            tracing::warn!(error = %e, %sha, "github commit fetch failed; storing sha only");
            (None, None, None, None)
        }
    };

    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO culprit_commits \
         (id, project_id, issue_id, commit_sha, author, message, committed_at, html_url, \
          confidence, source) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 100, 'manual') \
         ON CONFLICT (issue_id, commit_sha) DO NOTHING",
    )
    .bind(id)
    .bind(project_id)
    .bind(issue_id)
    .bind(sha)
    .bind(author.as_deref())
    .bind(message.as_deref())
    .bind(committed_at)
    .bind(html_url.as_deref())
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(StatusCode::CREATED.into_response())
}

pub async fn detach(
    State(state): State<AppState>,
    Path((project_id, issue_id, culprit_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    sqlx::query(
        "DELETE FROM culprit_commits \
         WHERE id = $1 AND project_id = $2 AND issue_id = $3",
    )
    .bind(culprit_id)
    .bind(project_id)
    .bind(issue_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Extract `(owner, repo)` from a GitHub URL like
/// `https://github.com/goliajp/sentori`. Strips `.git` suffix and
/// trailing slash. Returns None for non-GitHub URLs.
fn parse_github(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() < 5 {
        return None;
    }
    let host = parts[2];
    if !host.eq_ignore_ascii_case("github.com") && !host.ends_with("github.com") {
        return None;
    }
    Some((parts[3].to_string(), parts[4].to_string()))
}

struct GitHubCommit {
    author: String,
    message: String,
    committed_at: OffsetDateTime,
    html_url: String,
}

async fn fetch_github_commit(owner: &str, repo: &str, sha: &str) -> anyhow::Result<GitHubCommit> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{sha}");
    let client = reqwest::Client::builder()
        .user_agent("sentori-culprit/0.9.3")
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("github {} for {}/{}@{}", resp.status(), owner, repo, sha);
    }
    let body: serde_json::Value = resp.json().await?;
    let commit = body.get("commit").ok_or_else(|| anyhow::anyhow!("no commit"))?;
    let author_name = commit
        .pointer("/author/name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let message = commit
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let date = commit
        .pointer("/author/date")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("no date"))?;
    let committed_at = OffsetDateTime::parse(date, &time::format_description::well_known::Rfc3339)?;
    let html_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(GitHubCommit {
        author: author_name,
        message,
        committed_at,
        html_url,
    })
}
