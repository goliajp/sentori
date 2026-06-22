# Environment variables reference

## self-hosted server (`sentori-server`)

| Var | Required | Default | Notes |
|---|---|---|---|
| `SENTORI_DATABASE_URL` | yes | — | Postgres connection URL. `DATABASE_URL` also accepted as fallback. |
| `SENTORI_BIND` | no | `0.0.0.0:8080` | HTTP listen addr. |
| `SENTORI_BOOTSTRAP_OWNER_EMAIL` | no | — | If set + `_PASSWORD` set, auto-creates Owner on first boot. |
| `SENTORI_BOOTSTRAP_OWNER_PASSWORD` | conditional | — | Required when `_EMAIL` is set. Argon2id-hashed at boot via S13 stone. |
| `RUST_LOG` | no | `info,sqlx=warn` | Standard tracing-subscriber filter. |
| `SENTORI_SMTP_HOST` | no | — | SMTP relay for K11 EmailTransport. When unset, password-reset etc. log the link instead of mailing. |
| `SENTORI_SMTP_PORT` | no | `587` | |
| `SENTORI_SMTP_USER` | no | — | |
| `SENTORI_SMTP_PASS` | no | — | |
| `SENTORI_SMTP_TLS` | no | `starttls` | `plain` / `none` / `off` → no TLS (mailpit dev). |
| `SENTORI_SMTP_FROM` | no | `sentori@golia.jp` | `From:` mailbox. |

## SaaS control plane (`sentori-saas`)

| Var | Required | Default | Notes |
|---|---|---|---|
| `SENTORI_SAAS_CONTROL_PLANE_DB_URL` | yes | — | Postgres URL for the `sentori_saas` control-plane DB. |
| `SENTORI_SAAS_TENANT_DB_ADMIN_URL` | yes | — | Postgres URL with `CREATEDB` privilege; used to spawn per-tenant DBs. Usually `postgres://saas:pw@host:5432/postgres`. |
| `SENTORI_SAAS_BIND` | no | `0.0.0.0:9090` | HTTP listen addr. |
| `SENTORI_STRIPE_WEBHOOK_SECRET` | no | — | `whsec_xxx` from Stripe dashboard. When unset, `/v1/saas/stripe/webhook` returns 503. |
| `RUST_LOG` | no | `info,sqlx=warn` | |

## Secrets vault (S12 — used by K services that need at-rest secret encryption)

| Var | Required | Default | Notes |
|---|---|---|---|
| `SENTORI_VAULT_MASTER_KEY` | conditional | — | Base64-encoded 32-byte AES-256-GCM key. Required when any K crate writes encrypted secrets. Set + protect via your secret manager. |
