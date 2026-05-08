# Sentori

Modern, RN-first error tracking platform. Self-hostable.

**Status:** active development. See [ROADMAP.md](./ROADMAP.md) for the 16-phase plan and current progress.

## Stack

- Backend: Rust + axum + PostgreSQL 18+ + Valkey
- Web dashboard: React + Vite + Tailwind v4 (full SPA)
- SDK: `@sentori/react-native` (JS + iOS native + Android native)

## Layout

```
sentori/
├── web/             # Dashboard SPA (React + Vite)
├── server/          # Rust + axum backend binary
├── sdk/
│   └── react-native/  # @sentori/react-native
├── cli/             # sentori-cli (sourcemap / dSYM upload)
├── marketing/       # sentori.golia.jp landing (Astro)
├── docs-site/       # docs.sentori.golia.jp (Astro Starlight)
├── docs/            # source markdown for protocol / guides
├── e2e/             # end-to-end test scaffolding
├── docker/          # Dockerfiles and production-compose
└── ROADMAP.md       # 16-phase plan
```

## License

TBD.
