# Contributing to Sentori

Thanks for considering a contribution! This repo is the
public OSS mirror of Sentori's self-hosted distribution.

## Quick start for contributors

```bash
git clone https://github.com/goliajp/sentori-selfhosted
cd sentori-selfhosted

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
   coupling. `core/crates/{license-jwt, privacy-salt,
   issue-fingerprint, …}`. Bench + fuzz + proptest +
   line cov > 95%.
2. **钢筋 (steel)** — business-aware libraries that
   own a schema slice. `core/crates/{workspace-identity,
   event-pipeline, …}`. testcontainers PG integration
   tests + line cov > 85%.
3. **水泥 (cement)** — composition into running binaries.
   `self-hosted/server`, `saas/server`. Acceptance tests
   over the composed stack.

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

The CI workflow (`.github/workflows/v0.1-core.yml`)
runs the same gates plus a postgres service container —
breakage there blocks merge.

## Schema changes

- Add a numbered migration file in `core/migrations/`
  (next free 4-digit prefix).
- Bump test fixtures in the owning K crate's
  `tests/integration.rs` to exercise the new shape.
- Document the shape in
  `docs-v0.1/concept/data-model.md`.

## What goes upstream

- New K crate composing existing primitives — sure.
- New OSS-tier feature (alert rule kind, integration
  adapter, metric counter) — sure.
- SaaS-specific feature (billing portal, multi-tenant
  admin UI) — these live in the private SaaS repo and
  don't migrate to the mirror.
- Breaking SDK API change — please coordinate via an
  issue first; we hold a backward-compat window per
  `docs-v0.1/reference/api-compat.md`.

## License

By contributing, you agree your work is dual-licensed
**Apache-2.0 OR MIT** to match the repo. Owner is GOLIA
K.K. per `LICENSE-APACHE` / `LICENSE-MIT` /
`NOTICES.md`.

## Communication

- Bug reports: GitHub issues (use templates).
- Security issues: see `.github/SECURITY.md`.
- General discussion: GitHub Discussions or
  `#sentori-community` (TBD).
