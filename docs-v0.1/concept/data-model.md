# Data model

15 migrations (`core/migrations/0001-0015`) define the
entire v0.1 schema. Self-hosted and SaaS both run them
against a **single shared Postgres database**. Multi-tenancy
in SaaS is achieved by a `workspace_id UUID NOT NULL` column
on every tenant-bearing table + Postgres RLS policies that
filter rows by a session GUC (`app.current_workspace`).

See `docs-v0.1/internal/single-db-pivot-decomposition.md` for
the full design; this page is the user-facing summary.

## Migration order

| # | File | Owner crate | Contents |
|---|------|-------------|----------|
| 0001 | workspace_identity | K1 | **workspaces** + users + workspace_members + projects + project_user_visibility + privacy_salts + workspace_invites + app_user_identities + audit_logs + `current_workspace_id()` STABLE function + RLS policies on all 9 |
| 0002 | auth_session | K2 | sessions + email_verifications + password_reset_tokens |
| 0003 | event_pipeline | K4 | issues + events + identity_fingerprints + project_dropped (partitioned) |
| 0004 | issue_triage | K5 | issue status state machine columns + indexes |
| 0005 | span_pipeline | K6 | spans (partitioned monthly) + trace_session_rollup |
| 0006 | push_tokens | K7 | push_tokens + push_token_quarantine |
| 0007 | replay_sessions | K8 | replay_sessions |
| 0008 | runtime_metrics | K9 | runtime_metrics_raw (daily partitions) + _1m / _1h / _1d rollups + _dropped |
| 0009 | cert_observations | K10 | cert_watch_domains + cert_observations |
| 0010 | delivery_log | K11 | delivery_log |
| 0011 | integrations | K12 | integrations + issue_integration_links |
| 0012 | audit_log_indexes | K13 | 3 partial indexes on the K1 audit_logs table |
| 0013 | alert_rules | K14 | alert_rules |
| 0014 | saved_views | K15 | saved_views |
| 0015 | billing | K17 | workspace_billing (one-per-workspace) + usage_counters |

## Multi-tenancy model (2026-06-22 single-db pivot)

Sentori v0.1 uses a **single shared database** with
row-level multi-tenancy:

- A `workspaces` table is the root of the tenant tree
  (self-hosted seeds one row at bootstrap; SaaS creates one
  per signup).
- Every tenant-bearing table carries a `workspace_id UUID NOT
  NULL` column.
- Postgres RLS policies on each table key off a STABLE
  helper function `current_workspace_id()` which reads the
  per-session GUC `app.current_workspace`.
- The application layer uses `WorkspaceScopedPool` (in
  `sentori-workspace-identity`) which sets the GUC at every
  connection / transaction checkout.
- Self-hosted deployments use a constant `DEFAULT_WORKSPACE_ID`
  UUID so dump / restore between self-hosted instances round-
  trips trivially.

This model replaces the original "schema-per-tenant" design
(see decomposition doc). Performance overhead of RLS is < 5%
because policies are rewritten by the query planner into
ordinary WHERE clauses against existing indexes.

## Partitioning

Two K crates use PostgreSQL declarative partitioning:

- **K6 spans** — monthly partitions, 14-day retention default.
- **K9 runtime_metrics_raw** — daily partitions, 90-day retention default.

Both have a `PartitionLifecycle` sub-handle with
`ensure_future(now, ahead)` + `drop_before(cutoff)`
methods. The K9 design lock notes that a third partition
consumer (planned retro-K4 events) will trigger extraction
of a shared `partition-lifecycle` stone (rule-of-3).

## FK cascade strategy

- `projects` deletion cascades to every per-project
  table (issues, events, spans, replays, runtime_metrics,
  integrations, alert_rules, saved_views, usage_counters).
- `users` deletion cascades to `workspace_members`,
  `sessions`, `project_user_visibility`, personal saved
  views. Audit log + alert rule `created_by` are
  `ON DELETE SET NULL` so history survives subject
  deletion.

## Period keys

Two crates use UTC `YYYYMM` period keys:
- K9 — `usage_counters.period_yyyymm` for monthly
  rollups.
- K17 — `usage_counters.period_yyyymm` for billing
  quota windows.

Same shape, same `period_key(now)` helper.
