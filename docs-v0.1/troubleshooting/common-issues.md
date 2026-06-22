# Troubleshooting — common issues

## "could not connect to postgres" at boot

Check the DB URL + that pg is actually up:

```bash
docker compose ps
# If postgres is "starting", wait. If "exited", check logs:
docker compose logs postgres
```

The compose stack has a `depends_on: condition: service_healthy`
so the server waits for `pg_isready` before booting. If
the server logs say "db connect" failed after the healthcheck
passes, the URL is likely wrong (typo / port mismatch).

## "workspace_billing not initialised"

K17 ships a `BillingService::ensure_default()` call in
the self-hosted bootstrap that creates the singleton
free-tier row. If you see this error post-boot, the
bootstrap path failed for an upstream reason. Manually
fix:

```sql
INSERT INTO workspace_billing (id, plan, status)
VALUES (gen_random_uuid(), 'free', 'active');
```

## "quota exceeded" 429 on every event

Check K17 limits + current usage:

```sql
-- What plan is this workspace on?
SELECT plan, status FROM workspace_billing;
-- How much have we used this period?
SELECT * FROM usage_counters WHERE period_yyyymm = to_char(now(), 'YYYYMM');
```

Free plan: 100K events / month. Pro: 5M. Reset on the
1st UTC.

## bootstrap owner created with wrong email

The bootstrap is idempotent on "owner row exists" — it
won't replace the existing Owner. To reset:

```sql
DELETE FROM workspace_members WHERE role = 'owner';
DELETE FROM users WHERE email = 'OLD-EMAIL';
-- then restart with the corrected SENTORI_BOOTSTRAP_OWNER_EMAIL
```

## migrations stuck / partially applied

```sql
SELECT * FROM _sqlx_migrations ORDER BY version DESC LIMIT 5;
```

If a migration is stuck mid-execution, restore from a
pre-deploy backup. Sentori migrations don't have a
"forward-only repair" path — DB backup before upgrading
is on the operator.

## helm install — pod CrashLoopBackOff

```bash
kubectl -n sentori logs -l app.kubernetes.io/instance=sentori --tail=200
```

Most common cause: `SENTORI_DATABASE_URL` points at a
postgres that isn't reachable from the pod (security
group / network policy). Either:
- enable the embedded postgres in chart values
  (`postgres.enabled=true`), OR
- verify the external DB is reachable
  (`kubectl run -it --rm pg-test --image=postgres:18-alpine -- psql $URL`).
