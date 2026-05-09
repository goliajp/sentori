# Sentori

Modern, RN-first error tracking. Self-hostable. **v0.1.0** is the
self-hosted release; SaaS at `sentori.golia.jp` follows in v0.2.

Sentori is a Sentry replacement built ground-up: single-JSON event
schema (no envelope), camelCase wire format, embedded migrations, and a
single-binary axum server. It captures JavaScript errors, iOS
`NSException`, and Android uncaught exceptions from React Native apps,
groups them by fingerprint, and shows them in a dense Linear-style
dashboard with full keyboard navigation.

## Status

- **v0.1.0 — self-hosted, single-host docker compose.** Running.
- **v0.2 — SaaS at `sentori.golia.jp`.** ROADMAP phases 11–16.

See [`ROADMAP.md`](./ROADMAP.md) for the 16-phase plan and current
progress.

## Quickstart

```bash
git clone <repo> sentori
cd sentori

cat > .env <<EOF
SENTORI_DEV_TOKEN=st_pk_dev0000000000000000000000
SENTORI_ADMIN_PASSWORD=changeme
SENTORI_SESSION_SECRET=$(openssl rand -hex 32)
SENTORI_PG_PASSWORD=$(openssl rand -hex 16)
EOF

docker compose up -d
open http://localhost:8000
```

Sign in with `SENTORI_ADMIN_PASSWORD`. See the
[full getting-started guide](./docs/getting-started.md) for sending
your first event.

## Stack

- **Backend:** Rust + axum 0.8 + PostgreSQL 18 + Valkey
- **Dashboard:** React 19 + Vite + Tailwind v4 + jotai + react-query
- **SDK:** `@sentori/react-native` — JS + iOS Swift + Android Kotlin
  (Expo Module API)
- **CLI:** `sentori-cli` — source-map upload (Rust)

Eight migrations, one binary, ~5300 LoC of Rust + ~1700 LoC of TS in
the dashboard at v0.1.0.

## Layout

```
sentori/
├── server/         # Rust + axum backend binary
├── web/            # Dashboard SPA (React + Vite)
├── sdk/
│   └── react-native/  # @sentori/react-native (JS + iOS + Android)
├── cli/            # sentori-cli (Rust)
├── docs/           # Markdown — protocol, getting-started, sdk, self-hosting
├── e2e/            # End-to-end smoke (bun + curl)
├── docker/         # Dockerfile.server / Dockerfile.web / nginx.conf
├── docker-compose.yml
├── .github/workflows/build.yml
└── ROADMAP.md
```

## Documentation

- [Getting started](./docs/getting-started.md) — 5-minute quickstart
- [SDK reference](./docs/sdk-react-native.md) — `@sentori/react-native`
- [Self-hosting guide](./docs/self-hosting.md) — production deploy,
  SMTP, source maps, backups
- [Protocol](./docs/protocol.md) — event wire format

## What v0.1.0 explicitly does NOT do

- Sentry protocol compatibility (intentional)
- Session replay, profiling, distributed tracing
- Native signal-based crashes (SIGSEGV) or Android ANR
- Multi-tenant / SSO / billing — coming in Phase 13–15
- Cloud SaaS — coming in Phase 11–16 at `sentori.golia.jp`

See ROADMAP.md "显式不在路线图内的事" for the full list.

## License

TBD.
