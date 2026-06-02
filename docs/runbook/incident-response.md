# Incident response

## Severity ladder

| Sev | Trigger | First response |
|-----|---------|---------------|
| **P1** | Ingest down for **everyone** (all SDKs see 5xx / connection refused) for ≥ 2 minutes; or PG unreachable; or unauthorized data exfiltration suspected | Page on-call **immediately** |
| **P2** | Ingest error rate ≥ 1% for ≥ 5 minutes (Prometheus `SentoriIngestErrorRateHigh`); or one of {dashboard, marketing, docs} is down; or backups failing for two consecutive nights | Page on-call within 15 minutes |
| **P3** | Background degradation (slow latency, single-org quota false-positive, broken UI in one browser, partial nav anomaly) | File a GitHub issue, fix during business hours |

P1 and P2 page; P3 doesn't.

## On-call rotation

- Page via **Better Stack** (`status.sentori.golia.jp` is the public face; the private status page is the on-call source of truth).
- Primary + secondary rotate weekly on Monday 09:00 JST. Schedule lives in Better Stack.
- The current primary is the only person who acks pages. Secondary backstops if primary is unreachable for 10 minutes.

## P1 playbook (60-second checklist)

1. **Ack the page** in Better Stack so the timer stops.
2. Open three tabs:
   - Better Stack uptime dashboard (`https://uptime.betterstack.com/...`)
   - Grafana **Sentori — Overview** dashboard (`ops/grafana-sentori-overview.json`)
   - Caddy logs on the app VM (`docker logs caddy --tail=200 -f`)
3. **Stop the bleeding before debugging:**
   - If the most recent deploy is < 30 min old → roll back per `deploy.md` ("Rollback").
   - Else if PG is unreachable → check the PG VM (`systemctl status postgresql`); if it's the disk, free space and restart; if it's process death, restart and start the [backup-restore](backup-restore.md) flow as a safety net.
   - Else if Valkey is unreachable → restart it (`docker compose -f production-compose.yml restart valkey`); the server fails open on quota / rate limits, so this is a yellow alert, not a red one.
4. **Communicate** in this order:
   - Update Better Stack status page (templates: "investigating ingest 5xx", "fix in progress", "monitoring").
   - Post in `#sentori-ops` Slack with what's broken + your timestamp.
   - If user-visible for > 15 min, send a brief email to org owners using the same wording.
5. Once ingest is healthy → spend ≥ 15 minutes watching dashboards before declaring resolved. Premature "all clear" is the most common P1 followup.

## P2 playbook

Same shape as P1 but with looser timing:

- Ack within 15 min.
- Diagnose, then fix or open a documented mitigation (e.g. "raised free-tier limit for org X by hand pending a real fix"). Don't roll forward without rollback being available.
- Postmortem is optional unless the same alert fires twice in a week.

## After the fact (any sev)

Within 48 hours, write a postmortem in `docs/postmortems/<YYYY-MM-DD>-<short-tag>.md`. Cover: timeline, root cause, contributing factors, what worked, what didn't, action items with owners. Five action items max — more than that and nothing gets done.

## Things that explicitly do NOT page

- Free-tier orgs hitting 100% of their quota (sub-E warning email handles this).
- A single project's recipient list bouncing on bad-email errors.
- Editor warnings in CI.
- Marketing-only build failures (CF Pages handles its own deploy state; sub-G covers retries).
