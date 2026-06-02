# Backup & restore

The mechanics live in [`ops/`](../../ops/). This runbook covers when to use them and how to verify they actually work.

## What we back up

| What | Where | How often | Retention |
|------|-------|-----------|-----------|
| Postgres logical dumps (`pg_dump --format=custom`) | Cloudflare R2: `r2:sentori-backups/daily/sentori-<stamp>.dump` | Nightly at 04:00 UTC via cron (`ops/backup.sh`) | 30 days, then `rclone delete --min-age=30d` sweeps |
| Postgres WAL segments | R2: `r2:sentori-backups/wal/<segment>` | Continuous (`archive_timeout = 300s`, see `ops/postgresql.archive.conf`) | 30 days |
| Source-map artifacts | App VM `/data/artifacts/<sha256>` | Created on `cli upload sourcemap` | Indefinite (small; cleaned up only when the project is deleted) |
| App VM filesystem | not backed up | — | — |
| Secrets | `.sops.yaml` recipients + age keys on operator laptops | Manual rotation per `ops/secrets.md` | — |

App VMs are intentionally treated as cattle: redeploying from `production-compose.yml` reproduces the entire app surface. The only stateful thing the app VM owns is the `/data/artifacts` volume, which is reproducible (just re-upload the maps next deploy).

## When to restore

| Situation | Action |
|-----------|--------|
| PG VM is healthy but a single table is corrupt | `pg_restore -t <table>` from the latest dump into a temporary database, then move rows over. **Do not** restore over a healthy live DB. |
| PG VM is dead | Provision a fresh one, run `restore.sh`, point app VMs at the new host (update `DATABASE_URL` in compose `.env` and `docker compose up -d --no-deps server-blue server-green`). |
| You need state from earlier today | Restore the latest nightly + replay WAL up to the desired moment (PITR). |
| You need to dry-run a schema migration on real data | Restore the latest nightly into a sandbox DB, run the migration there. |

## Restore procedure (full failover)

Full sequence assuming the PG VM is gone:

```sh
# On a freshly provisioned PG VM:
sudo -u postgres rclone config show r2  # confirm rclone is wired up

PGPASSWORD=... \
  RCLONE_REMOTE=r2:sentori-backups \
  /opt/sentori/restore.sh
# Interactive prompt: type "yes". Restore takes O(GB / 100 MB·s) ~minutes.

# (optional) point-in-time recovery: replay WAL up to a given moment.
# Place this in /var/lib/postgresql/18/main/recovery.signal:
#   restore_command = 'rclone copyto r2:sentori-backups/wal/%f %p'
#   recovery_target_time = '2026-05-09 03:55:00 UTC'
# Then restart postgres.

# Update app VM env to the new PG host:
sudoedit /etc/sentori/.env  # set DATABASE_URL=postgres://...@<new-host>:5432/sentori
docker compose -f docker/production-compose.yml --env-file /etc/sentori/.env \
    up -d --no-deps server-blue server-green
```

## Drill (quarterly)

This counts only if you actually rebuild a fresh VM end-to-end. Skipping the drill means we don't know the procedure works.

1. `terraform apply` (or the Hetzner console) → fresh PG VM, same shape as prod.
2. `ssh` in, install Postgres + rclone, drop the same R2 credentials.
3. `restore.sh` against a *different* DB name (`sentori_drill`) so you don't shoot prod by accident.
4. Spot-check the restored DB:
   ```sql
   SELECT count(*) FROM users;
   SELECT count(*) FROM orgs;
   SELECT count(*) FROM events;
   SELECT max(received_at) FROM events;
   ```
5. Time the whole thing wall-clock. **RTO target is ≤ 30 min** for a current-month restore.
6. Update this file's "Last drill" line below.

**Last drill:** _never (Phase 16 sub-C TODO)_

If the drill fails, file a P2 incident immediately — production has no working DR until it passes.

## What can go wrong

| Symptom | Likely cause |
|---------|-------------|
| `restore.sh` says "no dumps found" | rclone remote misconfigured, or the cron job hasn't run yet. Check `/var/log/sentori-backup.log` on the PG VM. |
| `pg_restore` fails with "role doesn't exist" | We use `--no-owner --no-acl`; this shouldn't happen. If it does, ensure the target DB role matches the dump's. |
| WAL replay never reaches `recovery_target_time` | The target is past the most recent archived segment. Wait for the next archive (≤ 5 min) or pick an earlier target. |
| Disk fills with WAL on the source PG | `archive_command` is failing silently — check PG log. Most often: expired R2 credentials. Fix and reload PG; do not delete WAL by hand. |
