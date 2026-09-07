# Contributing to Sentori

Thanks for considering a contribution!

> **Where this file lives.** This is the private development
> repo. `.github/CONTRIBUTING.md` is on the OSS mirror's
> exclude list, so it does **not** ship to
> `goliajp/sentori-selfhosted` — which means the public repo
> currently has no contributing guide at all. That is a
> distribution decision, not an oversight to route around
> here.

## Quick start for contributors

```bash
git clone https://github.com/goliajp/sentori.git
cd sentori

# core/ is a single cargo workspace.
cd core
cargo test --workspace -- --test-threads=2  # testcontainers PG
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check

# self-hosted binary (standalone workspace)
cd ../self-hosted/server
cargo build --release

# Local stack
cd ../docker
cp .env.example .env
docker compose up -d
```

## Code style

- Rust **2024 edition**, `rustc 1.85+`.
- `cargo fmt` is the source of truth — no bikeshedding.
- `clippy::pedantic + nursery` is on by default;
  per-crate `#![allow]` is acceptable when the lint
  fights an otherwise-clean idiom (documented inline).
- `#![forbid(unsafe_code)]` workspace-wide for `core/`.

## Architecture rules (cement-stone)

Every code change should fit one of three tiers:

1. **石头 (stones)** — pure libraries with no business
   coupling. `core/crates/{privacy-salt,
   issue-fingerprint, rate-limiter, …}`. Bench + fuzz +
   proptest + line cov > 95%.
2. **钢筋 (steel)** — business-aware libraries that
   own a schema slice. `core/crates/{ingest-token,
   attachment-store, push-provider, notifier}`.
   Integration tests + line cov > 85%.
3. **水泥 (cement)** — composition into running binaries.
   `self-hosted/server`. Acceptance tests over the
   composed stack.

`core/README.md` has the full tier assignment, taken from
each crate's own `Cargo.toml` rather than from memory.

Don't mix tiers — e.g. don't put business types in a
stone, don't put pure-data utilities in cement.

## PR checklist

Before opening a PR, run:

```bash
cd core
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace -- --test-threads=2
RUSTDOCFLAGS='--deny warnings' cargo doc --workspace --no-deps
```

`.github/workflows/v0.2-core-check.yml` runs fmt, clippy
and check on every push to `feature/**`, `fix/**`,
`hotfix/**`, `develop` and `master` that touches `core/**`
or `self-hosted/server/**`.

`bun run preflight` from the repo root is the wider gate
and the one that matters: it runs everything CI runs plus
about thirty checks CI does not, and for `release/*`
branches — which deploy production directly — it is the
**only** gate.

## Schema changes

- Add a numbered migration file in `core/migrations/`
  (next free 4-digit prefix).
- Migrations are embedded at compile time
  (`sqlx::migrate!` in `self-hosted/server/src/main.rs`)
  and run at boot, so they re-apply on every restart of
  every install. Make them idempotent.
- Bump the owning crate's tests to exercise the new shape.
- `scripts/check-sql-tables-exist.mjs` fails the build if
  any SQL in the tree names a table no migration creates.

## What goes upstream

- New K crate composing existing primitives — sure.
- New OSS-tier feature (alert rule kind, integration
  adapter, metric counter) — sure.
- Breaking SDK API change — please coordinate via an
  issue first; the token format (`st_pk_<26 base32>`) is
  a permanent contract.

Sentori is self-host only. The SaaS surface — orgs,
quotas, billing, the multi-tenant admin UI — was removed
in the v1 redesign along with sixteen crates, so there is
no private SaaS repo to route such work to any more.

## License

By contributing, you agree your work is dual-licensed
**Apache-2.0 OR MIT** to match the repo. Owner is GOLIA
K.K. per `LICENSE-APACHE` / `LICENSE-MIT` /
`NOTICES.md`.

## Communication

- Bug reports: GitHub issues (use templates).
- Security issues: see `.github/SECURITY.md`.
- General discussion: GitHub Discussions.
