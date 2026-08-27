---
title: External issue tracker setup (Linear / GitHub / GitLab / Jira)
description: One-way outbound + inbound metadata refresh. Sentori stays the source of truth.
---

v1.2 W7 admits four external issue-tracker adapters into Sentori.
All four follow the same shape:

- **Outbound** — on a new Sentori issue, the adapter creates the
  upstream item. On resolve, the upstream item gets closed. On
  regression, it gets re-opened plus a "Sentori reopened" comment.
- **Inbound webhook** — refreshes the link row's denormalised
  `external_title` / `external_status` / `external_updated_at` so
  the dashboard's "Linked issues" panel doesn't need to round-trip
  to the upstream API. Inbound `closed` (or equivalent) also flips
  the Sentori issue to resolved.

Sentori never mirrors assignee, labels, or priority in either
direction. The Sentori-side fields stay authoritative; upstream
fields stay theirs.

## Required env per Sentori deployment

| Adapter | Env var                                  |
|---------|------------------------------------------|
| Linear  | `SENTORI_LINEAR_CLIENT_ID`, `SENTORI_LINEAR_CLIENT_SECRET`, `SENTORI_LINEAR_WEBHOOK_SECRET` |
| GitHub  | `SENTORI_GITHUB_WEBHOOK_SECRET`          |
| GitLab  | `SENTORI_GITLAB_WEBHOOK_SECRET`          |
| Jira    | `SENTORI_JIRA_WEBHOOK_SECRET`            |

Linear is OAuth-based (org admins click "Connect"); the others are
manual-config and store the per-org credentials in
`integrations.config` JSONB. **v1.3 W11 added a dashboard settings
page** so operators no longer need to curl `/configure`; head to
the Integrations sidebar item, pick an adapter card, click Connect,
and fill the form. The form fields below match the dashboard.

## GitHub Issues

GitHub supports two auth modes; both are selectable as a top-of-modal
toggle on the dashboard card.

**PAT mode** (recommended for single-repo / single-org):
1. Generate a fine-grained PAT with `Issues: read+write` on the
   target repo (or a classic PAT with `repo` scope).
2. Click Connect on the GitHub card → choose "Personal access token"
   → paste the PAT + default repo.

**GitHub App mode** (v1.3 W13, for multi-org / production scale):
1. Create a GitHub App (your org → Settings → Developer settings →
   GitHub Apps → New). Permissions: Issues read+write.
2. Install the App on the target repo(s); note the installation id.
3. Generate a private key (PEM) on the App's settings page.
4. Click Connect on the GitHub card → choose "GitHub App" → paste
   App ID, installation ID, the full PEM, and a default repo.
5. Sentori signs a 9-min RSA-SHA256 JWT, exchanges for an
   installation access token (cached 55 min in-process), and uses
   it for all GitHub API calls.

In either case, the inbound webhook still uses
`SENTORI_GITHUB_WEBHOOK_SECRET` and posts to
`/v1/integrations/github/webhook` with `X-Hub-Signature-256`.

## GitLab Issues

1. Project Access Token with scope `api` (or read_api +
   write_repository on a fine-grained token).
2. Click Connect on the GitLab card → paste access token + project
   id (numeric or URL-encoded `group/project`). `baseUrl` is optional
   (defaults to gitlab.com).
3. GitLab webhook: URL `…/v1/integrations/gitlab/webhook`, secret
   token = `SENTORI_GITLAB_WEBHOOK_SECRET`, trigger Issues events.

## Jira

Jira supports two deployments; both are selectable on the card.

**Cloud** (recommended):
1. Atlassian API token from id.atlassian.com → Security → API tokens.
2. Click Connect on the Jira card → choose "Jira Cloud" → paste
   email + API token + site (e.g. `yourco.atlassian.net`) + project
   key + (optional) issue type.

**Server / Data Center** (v1.3 W12):
1. Generate a Personal Access Token on your Jira instance
   (Profile → Personal Access Tokens).
2. Click Connect on the Jira card → choose "Jira Server / DC" →
   paste PAT + base URL (e.g. `https://jira.mycompany.com`) +
   project key + (optional) issue type.

For both: the inbound webhook URL is
`…/v1/integrations/jira/webhook?secret=<SENTORI_JIRA_WEBHOOK_SECRET>`
(Jira doesn't HMAC-sign payloads — we route on a URL secret).

## What's deferred to v1.4+

- True OAuth 3LO for Jira Cloud (today's flow is API-token based).
- Per-issue label / assignee mirror — Sentori stays single-source-
  of-truth.
- Email notification channel for the per-user prefs (v1.3 W14
  stores the channel choice but no email worker yet).
