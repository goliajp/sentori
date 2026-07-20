# Sentori v0.1 — `docs-v0.1/`

User-facing documentation for Sentori v0.1. Publish target:
`docs.sentori.golia.jp/v0.1/`.

Separate from legacy `docs-site/` — v0.1 is fresh-start;
docs don't inherit the legacy IA.

## Sections

| Path | Audience |
|---|---|
| [`quick-start/`](./quick-start/) | First-time operator getting Sentori running on their laptop / cluster. |
| [`concept/`](./concept/) | Architects + curious users learning what's in the box. |
| [`reference/`](./reference/) | Day-2 lookup — env vars / API / data model. |
| [`troubleshooting/`](./troubleshooting/) | Operators debugging a deploy. |

## Index

### Quick start
- [Docker Compose](./quick-start/docker-compose.md) — 30s laptop install.
- [Helm](./quick-start/helm.md) — Kubernetes install.

### Concept
- [Overview](./concept/overview.md) — what's in v0.1.
- [Data model](./concept/data-model.md) — 15 migrations + partitioning + cascade rules.

### Reference
- [Environment variables](./reference/env-vars.md) — every env var, for both binaries.
- [SDK integration](./reference/sdk-integration.md) — POST /v1/events shape.

### Troubleshooting
- [Common issues](./troubleshooting/common-issues.md) — boot / quota / migration / k8s.

## Status

`[x]` SH1 ship 准备 — initial content shipped 2026-06-21.
Future: docs site framework (Astro Starlight or similar)
+ search + versioned docs once v0.2 is in flight.
