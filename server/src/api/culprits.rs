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
        return Err(AppError::Unconfigured("sourceRepoUrlNotConfigured"));
    };
    let (owner, repo) = parse_github(&repo_url)
        .ok_or(AppError::Unconfigured("sourceRepoUrlNotGithub"))?;

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

/// v1.1 +S3 — auto-detect a culprit commit for an issue.
///
/// Pulls the issue's most recent event, extracts file paths from its
/// stack frames (top 30), fetches the last 100 commits from the
/// project's GitHub repo (via `SENTORI_GITHUB_PAT` env on the server),
/// scores each commit on:
///   - file overlap with the stack (10 points per matching file)
///   - time proximity to issue.first_seen (1 point per hour within
///     a 7-day window, capped at 168)
/// Attaches the top-scoring commit (if any) as a `source='auto'`
/// culprit with confidence = clamp(score, 0, 100). Subsequent runs
/// silently no-op on already-attached SHAs (UNIQUE(issue_id, sha)).
pub async fn auto_detect(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };

    let pat = match std::env::var("SENTORI_GITHUB_PAT") {
        Ok(v) if !v.is_empty() => v,
        _ => return Err(AppError::Unconfigured("githubPatNotConfigured")),
    };

    let repo_url: Option<String> = sqlx::query_scalar(
        "SELECT source_repo_url FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .flatten();
    let Some(repo_url) = repo_url else {
        return Err(AppError::Unconfigured("sourceRepoUrlNotConfigured"));
    };
    let (owner, repo) = parse_github(&repo_url)
        .ok_or(AppError::Unconfigured("sourceRepoUrlNotGithub"))?;

    let issue: Option<(time::OffsetDateTime,)> = sqlx::query_as(
        "SELECT first_seen FROM issues WHERE id = $1 AND project_id = $2",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let Some((first_seen,)) = issue else {
        return Err(AppError::NotFound);
    };

    // Pull the issue's most recent event payload — we use its stack
    // frames to extract candidate filenames.
    let event_payload: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT payload FROM events WHERE issue_id = $1 \
         ORDER BY received_at DESC LIMIT 1",
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let stack_files = event_payload
        .as_ref()
        .map(extract_stack_files)
        .unwrap_or_default();
    if stack_files.is_empty() {
        return Err(AppError::Internal(
            "no stack frames with file paths found in latest event".into(),
        ));
    }

    // GitHub: list last 100 commits on the default branch around the
    // issue first_seen window. The `since` / `until` params narrow
    // the search server-side so we don't burn rate limit on commits
    // outside our scoring window.
    let since = first_seen - time::Duration::days(7);
    let until = first_seen + time::Duration::hours(1);
    let commits = fetch_recent_commits(&pat, &owner, &repo, since, until)
        .await
        .map_err(|e| AppError::Internal(format!("github fetch: {e}")))?;

    if commits.is_empty() {
        return Err(AppError::Internal(
            "no commits in scoring window — extend repo activity or skip auto-detect".into(),
        ));
    }

    // Score: top file overlap + time proximity. For file overlap we
    // need the commits' touched-files lists which the list endpoint
    // doesn't return — fetch the commit detail for the top 10 by
    // time-proximity first to avoid burning rate limit on 100 detail
    // calls.
    let mut ranked: Vec<(f64, &GitHubCommitListEntry)> = commits
        .iter()
        .map(|c| {
            let prox = time_proximity_score(c.committed_at, first_seen);
            (prox, c)
        })
        .collect();
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let top_proxy = ranked.into_iter().take(10).collect::<Vec<_>>();

    let mut best: Option<(f64, &GitHubCommitListEntry, Vec<String>)> = None;
    for (prox_score, c) in &top_proxy {
        let files = fetch_commit_files(&pat, &owner, &repo, &c.sha).await.unwrap_or_default();
        let overlap = file_overlap_score(&files, &stack_files);
        let total = overlap * 10.0 + *prox_score;
        match &best {
            Some((b, _, _)) if *b >= total => {}
            _ => best = Some((total, c, files)),
        }
    }

    let Some((score, chosen, _files)) = best else {
        return Err(AppError::Internal("scoring failed".into()));
    };
    if score < 5.0 {
        return Err(AppError::Internal(format!(
            "no candidate scored above threshold (best={score:.1})"
        )));
    }
    let confidence = score.clamp(0.0, 100.0) as i32;

    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO culprit_commits \
         (id, project_id, issue_id, commit_sha, author, message, committed_at, html_url, \
          confidence, source) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'auto') \
         ON CONFLICT (issue_id, commit_sha) DO UPDATE SET \
             confidence = GREATEST(culprit_commits.confidence, EXCLUDED.confidence), \
             source = 'auto'",
    )
    .bind(id)
    .bind(project_id)
    .bind(issue_id)
    .bind(&chosen.sha)
    .bind(chosen.author.as_deref())
    .bind(chosen.message.as_deref())
    .bind(chosen.committed_at)
    .bind(chosen.html_url.as_deref())
    .bind(confidence)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "commitSha": chosen.sha,
        "confidence": confidence,
        "score": score,
    }))
    .into_response())
}

/// v1.1 +S3 — Generate a Revert PR for a culprit commit.
pub async fn generate_revert_pr(
    State(state): State<AppState>,
    Path((project_id, issue_id, culprit_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };

    let pat = match std::env::var("SENTORI_GITHUB_PAT") {
        Ok(v) if !v.is_empty() => v,
        _ => return Err(AppError::Unconfigured("githubPatNotConfigured")),
    };

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT commit_sha FROM culprit_commits WHERE id = $1 AND issue_id = $2 \
         AND project_id = $3",
    )
    .bind(culprit_id)
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let Some((sha,)) = row else {
        return Err(AppError::NotFound);
    };

    let repo_url: Option<String> = sqlx::query_scalar(
        "SELECT source_repo_url FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .flatten();
    let Some(repo_url) = repo_url else {
        return Err(AppError::Unconfigured("sourceRepoUrlNotConfigured"));
    };
    let (owner, repo) = parse_github(&repo_url)
        .ok_or(AppError::Unconfigured("sourceRepoUrlNotGithub"))?;

    // GitHub revert PR generation:
    //   1. GET /repos/:o/:r → default branch + latest SHA
    //   2. Create branch `sentori-revert-<sha[..7]>` at default head
    //   3. Use the `revert` API endpoint or compose the revert manually.
    //
    // The GitHub REST API doesn't expose a clean "revert commit" call
    // — the right path for autorun is to *open a PR with an empty body*
    // pointing at the commit's parent SHA and let the human dev cherry-
    // pick the revert locally. We deliver a draft PR that links the
    // sentori issue and the offending commit; the developer takes it
    // from there.
    let pr = open_revert_draft_pr(&pat, &owner, &repo, &sha, issue_id)
        .await
        .map_err(|e| AppError::Internal(format!("github PR: {e}")))?;

    Ok(Json(serde_json::json!({ "prUrl": pr.html_url })).into_response())
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

// v1.1 +S3 — auto-detect helpers.

struct GitHubCommitListEntry {
    sha: String,
    author: Option<String>,
    message: Option<String>,
    committed_at: time::OffsetDateTime,
    html_url: Option<String>,
}

fn extract_stack_files(payload: &serde_json::Value) -> Vec<String> {
    let stack = payload.pointer("/error/stack").and_then(|v| v.as_array());
    let Some(frames) = stack else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for frame in frames.iter().take(30) {
        if let Some(file) = frame.get("file").and_then(|v| v.as_str()) {
            // Normalize: strip query strings, drop leading slashes,
            // collapse repeated separators. Keep file basename + 1-2
            // parent dirs for matching (paths in sourcemaps tend to
            // include `src/...` which matches commit file paths well).
            let f = file.split('?').next().unwrap_or("");
            let f = f.trim_start_matches('/');
            if !f.is_empty() && !f.starts_with('<') {
                out.push(f.to_string());
            }
        }
    }
    out
}

fn time_proximity_score(commit_ts: time::OffsetDateTime, issue_first_seen: time::OffsetDateTime) -> f64 {
    let delta = (issue_first_seen - commit_ts).whole_seconds();
    if delta < 0 || delta > 7 * 24 * 3600 {
        return 0.0;
    }
    let hours = (delta as f64) / 3600.0;
    // Closer in time = higher score, max 168 (=7d * 24h).
    (168.0 - hours).max(0.0)
}

fn file_overlap_score(commit_files: &[String], stack_files: &[String]) -> f64 {
    if commit_files.is_empty() || stack_files.is_empty() {
        return 0.0;
    }
    let mut score = 0.0;
    for cf in commit_files {
        for sf in stack_files {
            // Match if commit file path ends with stack file path or
            // vice-versa. Sourcemap paths vs repo paths are rarely
            // identical so suffix match is a pragmatic default.
            if cf.ends_with(sf) || sf.ends_with(cf) {
                score += 1.0;
            } else {
                // Fall back to basename equality (covers minified
                // mangled paths where the dirname differs).
                let cb = cf.rsplit('/').next().unwrap_or("");
                let sb = sf.rsplit('/').next().unwrap_or("");
                if !cb.is_empty() && cb == sb {
                    score += 0.5;
                }
            }
        }
    }
    score
}

async fn fetch_recent_commits(
    pat: &str,
    owner: &str,
    repo: &str,
    since: time::OffsetDateTime,
    until: time::OffsetDateTime,
) -> anyhow::Result<Vec<GitHubCommitListEntry>> {
    let client = reqwest::Client::builder()
        .user_agent("sentori-culprit-auto/0.9.6")
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let since_iso = since.format(&time::format_description::well_known::Rfc3339)?;
    let until_iso = until.format(&time::format_description::well_known::Rfc3339)?;
    let url = format!(
        "https://api.github.com/repos/{owner}/{repo}/commits?since={since_iso}&until={until_iso}&per_page=100"
    );
    let resp = client
        .get(&url)
        .bearer_auth(pat)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("github commits list {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let arr = body.as_array().ok_or_else(|| anyhow::anyhow!("expected array"))?;
    let mut out: Vec<GitHubCommitListEntry> = Vec::new();
    for item in arr {
        let sha = item.get("sha").and_then(|v| v.as_str()).unwrap_or("");
        if sha.is_empty() {
            continue;
        }
        let commit = item.get("commit");
        let author = commit
            .and_then(|c| c.pointer("/author/name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let message = commit
            .and_then(|c| c.get("message"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let date = commit
            .and_then(|c| c.pointer("/author/date"))
            .and_then(|v| v.as_str());
        let committed_at = match date {
            Some(d) => time::OffsetDateTime::parse(d, &time::format_description::well_known::Rfc3339)?,
            None => continue,
        };
        let html_url = item
            .get("html_url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        out.push(GitHubCommitListEntry {
            sha: sha.to_string(),
            author,
            message,
            committed_at,
            html_url,
        });
    }
    Ok(out)
}

async fn fetch_commit_files(
    pat: &str,
    owner: &str,
    repo: &str,
    sha: &str,
) -> anyhow::Result<Vec<String>> {
    let client = reqwest::Client::builder()
        .user_agent("sentori-culprit-auto/0.9.6")
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{sha}");
    let resp = client
        .get(&url)
        .bearer_auth(pat)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("github commit {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let files = body.get("files").and_then(|v| v.as_array());
    let Some(files) = files else { return Ok(Vec::new()) };
    Ok(files
        .iter()
        .filter_map(|f| f.get("filename").and_then(|v| v.as_str()).map(String::from))
        .collect())
}

struct GitHubPrResult {
    html_url: String,
}

async fn open_revert_draft_pr(
    pat: &str,
    owner: &str,
    repo: &str,
    target_sha: &str,
    issue_id: uuid::Uuid,
) -> anyhow::Result<GitHubPrResult> {
    let client = reqwest::Client::builder()
        .user_agent("sentori-culprit-auto/0.9.6")
        .timeout(std::time::Duration::from_secs(20))
        .build()?;

    // Step 1: get repo default branch + its head SHA.
    let repo_info: serde_json::Value = client
        .get(format!("https://api.github.com/repos/{owner}/{repo}"))
        .bearer_auth(pat)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let default_branch = repo_info
        .get("default_branch")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("no default_branch"))?;

    let ref_info: serde_json::Value = client
        .get(format!(
            "https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{default_branch}"
        ))
        .bearer_auth(pat)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let head_sha = ref_info
        .pointer("/object/sha")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("no head sha"))?;

    // Step 2: create branch from head sha.
    let short_sha = &target_sha[..target_sha.len().min(7)];
    let branch_name = format!("sentori-revert-{short_sha}");
    let _create_branch: serde_json::Value = client
        .post(format!("https://api.github.com/repos/{owner}/{repo}/git/refs"))
        .bearer_auth(pat)
        .header("Accept", "application/vnd.github+json")
        .json(&serde_json::json!({
            "ref": format!("refs/heads/{branch_name}"),
            "sha": head_sha,
        }))
        .send()
        .await?
        .error_for_status()
        .map(|_| serde_json::Value::Null)
        .unwrap_or(serde_json::Value::Null);
    // If branch already exists GitHub returns 422 — we tolerate this
    // and reuse the branch (the PR open will surface "PR already exists"
    // if applicable).

    // Step 3: open PR. Body links sentori issue + offending commit.
    let body_md = format!(
        "Auto-generated by Sentori +S3.\n\n\
         **Issue**: `{issue_id}`\n\
         **Suspect commit**: `{target_sha}`\n\n\
         This PR is a *draft scaffold*. Apply the actual revert locally:\n\n\
         ```\n\
         git checkout {branch_name}\n\
         git revert {target_sha}\n\
         git push\n\
         ```\n\n\
         GitHub's REST API doesn't expose a clean server-side revert call.\n\
         Sentori opens this draft so you have one click from issue → PR;\n\
         the actual revert command runs on your machine.\n"
    );
    let pr: serde_json::Value = client
        .post(format!("https://api.github.com/repos/{owner}/{repo}/pulls"))
        .bearer_auth(pat)
        .header("Accept", "application/vnd.github+json")
        .json(&serde_json::json!({
            "title": format!("Revert: {short_sha} (sentori issue {issue_id})"),
            "head": branch_name,
            "base": default_branch,
            "body": body_md,
            "draft": true,
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let html_url = pr
        .get("html_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("no html_url in PR response"))?
        .to_string();
    Ok(GitHubPrResult { html_url })
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
