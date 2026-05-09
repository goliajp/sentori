# Launch checklist — sentori.golia.jp

Single source of truth for what has to be true before flipping the public-launch switch. Cross-references items I (the builder) own as `[code]` and items the human operator owns as `[ops]`. Everything `[code]` is done in the repo; everything `[ops]` needs the operator's hands on a console.

This list is the union of remaining items across Phase 11, Phase 12 sub-D, and Phase 16. If a phase is checked complete in `ROADMAP.md`, it's not repeated here unless a piece of it was deferred to launch time.

## Infrastructure (Phase 11 + 16 sub-A/C)

- [ ] [ops] Hetzner: 1 app VM (CCX23) + 1 PG VM (CPX21), private network between them
- [ ] [ops] DNS via the devops `zones.yaml`: `sentori`, `app`, `api`, `ingest`, `docs`, `cdn`, `status`. apex orange-cloud → CF Pages; subdomains grey-cloud → app VM IP
- [ ] [ops] App VM: docker installed, ports 80/443/443udp open, `docker/production-compose.yml` + `docker/Caddyfile` deployed via `ops/secrets.md` flow
- [ ] [ops] PG VM: Postgres 18 installed, all migrations from `server/migrations/` applied, `archive_command` from `ops/postgresql.archive.conf` enabled, rclone configured for R2
- [ ] [ops] `ops/backup.sh` running nightly; first backup landed in R2; first manual restore drill into a sandbox VM completed (record the wall-clock time in `docs/runbook/backup-restore.md` "Last drill")
- [ ] [ops] Better Stack monitors set up for app./api./ingest./docs./cdn./status./apex 200 + TLS expiry < 30 days
- [ ] [ops] `status.sentori.golia.jp` Better Stack public status page wired to those monitors

## Marketing + docs (Phase 12)

- [ ] [ops] Cloudflare Pages projects created: `sentori-marketing` → apex; `sentori-docs` → docs.
- [ ] [ops] GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (scope Pages: Edit) + `CLOUDFLARE_ACCOUNT_ID`
- [ ] [ops] First `workflow_dispatch` of `pages.yml` ran green; both subdomains return the live SPA
- [ ] [code] OG image (`marketing/public/og.png`) renders correctly on Twitter Card validator and LinkedIn share preview
- [x] [code] Pricing page reflects "open registration" wording (sub-G commit)

## Auth + multi-tenant (Phase 13–15)

- [ ] [ops] Pick a sender domain for transactional mail; SPF + DKIM + DMARC records published; SMTP credentials stored via sops
- [ ] [ops] First end-to-end live test: register a real email at `app.sentori.golia.jp`, click the verify link, accept an invite, send a captured event from a real device. Don't trust the launch until this passes against prod.
- [x] [code] Three smoke scripts (`scripts/test-phase13/14/15.sh`) all pass; CI's `mobile-e2e.yml` jobs all green on `main`

## Observability + ops (Phase 16 sub-B / sub-F)

- [ ] [ops] Grafana Cloud Loki workspace created, `ops/vector.toml` deployed on app VM, logs flowing
- [ ] [ops] Grafana dashboard imported from `ops/grafana-sentori-overview.json`
- [ ] [ops] Prometheus alert rules from `ops/prometheus-alerts.yml` loaded; PagerDuty / Better Stack on-call routing tested with a fake firing alert
- [x] [code] `/metrics` endpoint live on the server; ROADMAP marks PG-pool / Valkey-latency exposers as follow-ups (alert rules already stub them)
- [x] [code] Runbooks committed: `incident-response.md`, `scaling.md`, `backup-restore.md`, `deploy.md`

## Security / privacy (Phase 16 sub-D)

- [x] [code] HSTS / CSP / per-subdomain CORS in Caddyfile
- [x] [code] PII guardrails: server `User` schema `deny_unknown_fields`; SDK `setUser()` JSDoc explicit
- [x] [code] `GET /api/orgs/{slug}/export` (GDPR data export)
- [x] [code] Privacy / Terms drafts in `docs/legal/`
- [ ] [ops] Lawyer reviews `docs/legal/privacy.md` + `docs/legal/terms.md`, fills in `<…>` placeholders, signs off
- [ ] [ops] DPA template ready for any user who asks (separate doc, not in the repo)

## Testing backfill (Phase 16 sub-E)

- [x] [code] XCTest, Robolectric, mailcatcher, sourcemap-e2e jobs in `mobile-e2e.yml`
- [ ] [ops] Run the four `mobile-e2e.yml` jobs once on `main` to confirm green-on-default-branch (path filters mean they don't fire on every commit)

## Dogfooding (Phase 16 self-monitor)

- [ ] [ops] Mark every prod service ingest into the `sentori-internal` org on `sentori.golia.jp` itself: marketing site (Sentori JS SDK), dashboard (same SDK), server (a thin in-process forwarder; v0.3 task)
- [ ] [ops] Run dogfooding ≥ 1 week. P1 / P2 alerts pages must reach the on-call. No P1 incidents from real (not synthetic) traffic. If a P1 fires from real traffic, postpone launch by at least a week.

## Public-launch day

- [ ] [code] Tag `v0.2.0` from clean `main`; GitHub release notes summarize Phase 11–16
- [ ] [ops] Demo screencast recorded per `docs/launch/demo-script.md`; uploaded to `marketing/public/demo.{webm,mp4}` + `demo.vtt`; OG poster image regenerated
- [ ] [ops] Launch tweet / Mastodon post drafted; HN draft (`docs/launch/show-hn-draft.md`) refined to ≤ 80-char title + tight body
- [ ] [ops] Show HN posted Tuesday or Wednesday 08:00–09:00 PT
- [ ] [ops] On-call online for the next 12 hours; status page on second monitor; HN thread on first
- [ ] 🎯 Milestone: `sentori.golia.jp` public, registration open
