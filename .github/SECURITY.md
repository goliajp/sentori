# Security policy

## Reporting a vulnerability

If you find a security issue in Sentori (the OSS
self-hosted distribution or the SaaS at
`sentori.golia.jp`), please report it privately:

- Email: **security@golia.jp**
- PGP key (optional): _coming_

Please **do not** open a public GitHub issue for security
reports.

We aim to:
- Acknowledge receipt within **3 business days** (JST).
- Provide a triage assessment within **14 days**.
- Ship a fix within **45 days** for high-severity issues.
- Credit the reporter (with consent) in the release
  notes for the fix.

## Scope

In scope:
- `core/` crates (every K/S in the workspace).
- `self-hosted/server` binary + `self-hosted/docker` +
  `self-hosted/helm`.
- `saas/server` binary + `saas/docker` + `saas/helm`.
- Public docker images on `ghcr.io/goliajp/sentori-*`.

Out of scope:
- The legacy `server/` + `web/` tree pending retirement
  (`SH6` in `.claude/state/v0.1-execution-plan.md`).
- The SaaS dashboard's JS bundles (separate issue
  channel; coordinate with `app-security@golia.jp`).
- Customer-managed deployments — we provide best-effort
  guidance but ops-side concerns (network, secret
  storage, backups) are the operator's responsibility.

## Supported versions

| Version | Supported until |
|---|---|
| `v0.1.x` | TBD — earliest 12 months from `v0.1.0` GA. |
| pre-v0.1 (legacy) | not supported; treated as EOL once SH5 cutover completes. |

## Cryptography / dependency posture

- 0 unsafe code in `core/` (`#![forbid(unsafe_code)]`).
- Argon2id for password hashing (S13 stone, OWASP_2025
  params).
- AES-256-GCM via aws-lc-rs for at-rest secret envelopes
  (S12 vault).
- EdDSA (Ed25519) for license JWT (S1) — avoids
  RUSTSEC-2023-0071 in the `rsa` crate.
- TLS via rustls + webpki-roots; no native OpenSSL.

`cargo audit` runs on every CI build of the workspace.

## Hardening guidance

For operators of self-hosted deployments:
- Run behind a reverse proxy that terminates TLS.
- Restrict `/v1/events/*` ingest to known SDK origins
  via network policy or token auth.
- Set strong values for `SENTORI_BOOTSTRAP_OWNER_PASSWORD`
  and rotate after first login.
- Mount `SENTORI_VAULT_MASTER_KEY` via your platform's
  secret manager (k8s Secret + node-local encryption /
  AWS KMS / GCP KMS). Do NOT bake it into the image.
- Back up the postgres database before every upgrade.
  Migrations are forward-only.
