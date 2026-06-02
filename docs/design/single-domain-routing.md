# Single-domain routing — `sentori.golia.jp`

**Status**: design, awaiting devops Caddy update.
**Authors**: Lihao + Claude, 2026-05-23.
**Supersedes**: the three-subdomain split
(`app.sentori.golia.jp` / `docs.sentori.golia.jp` / `sentori.golia.jp`).

---

## Target

All Sentori UX lives under one domain, path-routed:

```
sentori.golia.jp/                              marketing static (Astro)
sentori.golia.jp/docs/*                        docs static (Astro Starlight, base=/docs)
sentori.golia.jp/login                         SPA auth
sentori.golia.jp/register                      SPA auth
sentori.golia.jp/verify                        SPA auth
sentori.golia.jp/forgot-password               SPA auth
sentori.golia.jp/reset-password/<token>        SPA auth
sentori.golia.jp/invite/<token>                SPA accept-flow
sentori.golia.jp/transfers/<token>             SPA accept-flow
sentori.golia.jp/main                          SPA dashboard root
sentori.golia.jp/main/*                        SPA dashboard children
sentori.golia.jp/admin/api/*                   backend (admin API)
sentori.golia.jp/api/*                         backend (org / auth API)

ingest.sentori.golia.jp/v1/*                   ingest API (unchanged, separate host)
```

`ingest.sentori.golia.jp` stays separate so:
- existing customer SDK tokens continue to work without re-init
- ingest traffic doesn't share TLS / rate-limit / log pipelines
  with the dashboard

## Why this matters

- One name to remember + share. "Go to sentori.golia.jp" works for
  everyone — marketing visitor, docs reader, customer signing in.
- Marketing + docs + dashboard share the same nav menu. The user
  flows are one continuous surface, not three sites linking out
  to each other.
- One TLS cert (already managed by origin Caddy).
- Cleanup: drops Cloudflare Pages dependency. Everything ships
  through the existing `deploy.yml` to the lx64 server.

## What's already done (sentori repo)

### Web SPA — paths refactored

- `web/src/main.tsx`: ProtectedLayout moved from `path: '/'` to
  `path: '/main'`. Auth routes (`/login`, `/register`, `/verify`,
  `/forgot-password`, `/reset-password/:token`, `/invite/:token`,
  `/transfers/:token`) stay at root.
- All internal `<Link>` and `navigate()` calls using absolute
  paths (`/org/...`, `/account`, `/onboarding`, `/me/...`,
  `/superadmin/...`) updated to include the `/main` prefix.
- Catch-all routes (`*`) redirect to `/main` so deep links land
  in a sane place.

Resulting SPA URLs:
```
/login           ← auth (root)
/main            ← dashboard (was /)
/main/org/<slug>/issues
/main/account
/main/superadmin/...
```

### Docs site — base path

- `docs-site/astro.config.mjs`: added `base: '/docs'`, updated
  `site: 'https://sentori.golia.jp'`. All built asset URLs and
  internal links resolve under `/docs/`.

### Marketing site — redesigned

- `marketing/src/pages/index.astro`: full rewrite. New 8-feature
  grid covering v2.3 capabilities (identity / Sentry compat /
  silent / NEVER rule). Hero quotes the new value prop. Footer
  links all use same-domain paths (`/docs`, `/main/register`,
  `/login`).

### Deploy workflow — already in place

- `deploy.yml` (existing): builds marketing + docs + web + server
  and rsyncs into `/apps/sentori/marketing-dist`, `/docs-dist`,
  `/src/web/dist`, then `docker compose up` for backend + web.
- `pages.yml` — **removed**. No more Cloudflare Pages dependency.

## What devops needs to do

Caddy on the origin server (lx64 host) currently terminates
TLS for `app.sentori.golia.jp` + `ingest.sentori.golia.jp`.
Repoint the origin's `sentori.golia.jp` block to the consolidated
layout:

```caddyfile
# Replace any existing sentori.golia.jp block with this.
sentori.golia.jp {
    encode gzip zstd

    # ── 1. Backend (admin + org/auth APIs) ───────────────────
    # Path PRESERVED (use `handle`, not `handle_path` — the Rust
    # router nests routes under `/admin/api` and `/api/auth` etc.
    # so the backend expects the full path).
    @backend {
        path /admin/api/* /api/*
    }
    handle @backend {
        reverse_proxy sentori-server:8080
    }

    # ── 2. Docs static (Astro Starlight, base=/docs) ─────────
    # Astro built files live at the dist root; the URL prefix /docs
    # is stripped before file_server resolves to disk.
    handle_path /docs/* {
        root * /apps/sentori/docs-dist
        try_files {path} {path}/ /404.html
        file_server
    }
    # Bare `/docs` (no trailing slash) → redirect to `/docs/`.
    redir /docs /docs/ permanent

    # ── 3. SPA paths — auth + accept-flows + /main/* ──────────
    # The web container (nginx) serves `index.html` for any unknown
    # path under these prefixes; React Router takes it from there.
    #
    # `/assets/*` — vite-built JS/CSS chunks the SPA's index.html
    #              references.
    # `/wasm/*`   — vite's `public/wasm/` copied verbatim; the SPA
    #              loads .wasm modules at runtime.
    #
    # (Marketing's built assets live at `/_astro/*`; docs' at
    # `/docs/_astro/*` — different paths, no collision with SPA.)
    @spa {
        path /login* /register* /verify* /forgot-password*
        path /reset-password/* /invite/* /transfers/*
        path /main /main/*
        path /assets/*
        path /wasm/*
    }
    handle @spa {
        reverse_proxy sentori-web:80
    }

    # ── 4. Default — marketing static ─────────────────────────
    handle {
        root * /apps/sentori/marketing-dist
        try_files {path} {path}/ /index.html
        file_server
    }

    log {
        output file /var/log/caddy/sentori-golia-jp.log {
            roll_size 50mb
            roll_keep 8
        }
        format console
    }
}

# Keep ingest on its own host — existing customer tokens point here.
ingest.sentori.golia.jp {
    encode gzip zstd
    reverse_proxy sentori-server:8080
}

# Legacy redirects so old links don't 404.
app.sentori.golia.jp {
    redir https://sentori.golia.jp/main{uri} permanent
}
docs.sentori.golia.jp {
    redir https://sentori.golia.jp/docs{uri} permanent
}
```

Drop into the devops repo's Caddyfile, `caddy reload`. The
`/apps/sentori/marketing-dist` and `/apps/sentori/docs-dist`
directories already get populated by `deploy.yml` on every push.

### DNS

Already pointed at the lx64 origin via `goliajp/devops/zones.yaml`:

```yaml
sentori.golia.jp:        A    <lx64-public-ip>
app.sentori.golia.jp:    A    <lx64-public-ip>   # redirect host
docs.sentori.golia.jp:   A    <lx64-public-ip>   # redirect host
ingest.sentori.golia.jp: A    <lx64-public-ip>
```

No DNS changes needed — TLS certs auto-issue via Caddy's ACME
when the new host blocks come up.

## What customers see

- Existing SDK customers: SDK still POSTs to
  `ingest.sentori.golia.jp/v1/events`. **No change**.
- Existing dashboard users with bookmarks on
  `app.sentori.golia.jp/org/<slug>/issues/<id>`: Caddy redirects
  to `sentori.golia.jp/main/org/<slug>/issues/<id>`. Bookmark
  silently follows; one extra HTTP hop on first visit.
- Existing docs links pointed at `docs.sentori.golia.jp/getting-started`:
  redirect to `sentori.golia.jp/docs/getting-started`.
- New users land on `sentori.golia.jp/` — see redesigned marketing.

## Rollback

`pages.yml` is in git history; revert that commit + add the
`app.*` / `docs.*` subdomain blocks back to Caddy. SPA route
changes are harder to roll back cleanly (the `<Link>` paths are
now `/main/*`); easier to just leave them and update Caddy to
serve the SPA at root again.

But the rollback story isn't really needed — same content, just
different routing. Caddy is the only piece that decides what
serves where.
