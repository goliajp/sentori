# Sentori — DNS / TLS

> **Superseded by v2.4 single-domain consolidation** (see
> [`docs/design/single-domain-routing.md`](../design/single-domain-routing.md)).
> Below is the original Phase 11 subdomain split — kept for the
> historical record of how the seven subdomains were set up — but
> production now runs a single `sentori.golia.jp` host with path
> routing (`/`, `/docs/*`, `/main/*`, `/admin/api/*`) plus the
> separate `ingest.sentori.golia.jp` host for SDK ingest. The
> legacy `app.sentori.golia.jp` / `docs.sentori.golia.jp` /
> `api.sentori.golia.jp` hosts still resolve and 301-redirect into
> the new layout. Don't follow the Caddy snippet in this file for
> a fresh deploy — use the block in single-domain-routing.md.

Reference for the seven subdomains under `sentori.golia.jp` and how
they're served. DNS is owned by the devops project's `zones.yaml`; this
file is the per-project view, with copy-pasteable fragments so a
sync-and-reload pass closes Phase 11 in one sitting.

## Subdomain map

| Subdomain | Segments | Role | Backend | Cloudflare proxy | TLS |
|---|---|---|---|---|---|
| `sentori.golia.jp` | 3 | Marketing | Cloudflare Pages | **orange** (proxied) | CF Universal SSL (auto, `*.golia.jp`) |
| `app.sentori.golia.jp` | 4 | Dashboard SPA | origin VM Caddy → `web` container | grey (DNS-only) | Caddy + Let's Encrypt |
| `ingest.sentori.golia.jp` | 4 | SDK ingest | origin VM Caddy → `server` | grey | Caddy + LE |
| `api.sentori.golia.jp` | 4 | Admin API (alt path) | origin VM Caddy → `server` | grey | Caddy + LE |
| `docs.sentori.golia.jp` | 4 | Docs (Astro Starlight) | origin VM Caddy / CF Pages | grey | Caddy + LE |
| `cdn.sentori.golia.jp` | 4 | SDK install / CLI tarballs | origin VM Caddy / R2 | grey | Caddy + LE |
| `status.sentori.golia.jp` | 4 | Status page (Phase 16) | Better Stack (CNAME) | grey | provider-managed |

Why 4-segment subdomains can't sit behind Cloudflare proxy: Universal
SSL only covers `*.golia.jp` (single layer wildcard), not
`*.sentori.golia.jp`. Cloudflare Advanced Certificate Manager ($20+/mo)
would fix it, but at v0.1 origin Caddy auto-issues per-subdomain Let's
Encrypt certs at zero cost — that's the chosen path.

## DNS records — paste into devops `zones.yaml`

In `~/workspace/goliajp/devops/zones.yaml`, append under the `golia.jp`
zone's `records` list:

```yaml
zones:
  golia.jp:
    records:
      # ── existing records preserved here ──

      # ── Sentori (Phase 11) ──
      - { name: sentori,         cname: <cf-pages-target> }   # marketing — fill in when Phase 12's CF Pages project is created
      - { name: app.sentori,     host: t01 }                  # dashboard SPA
      - { name: ingest.sentori,  host: t01 }                  # SDK ingestion
      - { name: api.sentori,     host: t01 }                  # admin API
      - { name: docs.sentori,    host: t01 }                  # docs site (or cname → CF Pages)
      - { name: cdn.sentori,     host: t01 }                  # SDK / CLI artifacts
      # status.sentori (Phase 16) → CNAME to Better Stack
```

The `host: t01` shorthand expects the existing `hosts.t01` entry in the
zones file (current value: 18.179.107.143 per the devops test fixtures).

Apply:

```bash
cd ~/workspace/goliajp/devops
cargo run -- dns diff             # MUST eyeball CREATE / DELETE / UPDATE first
cargo run -- dns sync             # apply only after the diff is confirmed
```

> Reminder per the devops `feedback_dns_delete.md` memory: **never run
> sync until the diff is screen-printed and explicitly confirmed**. The
> March 2026 incident (3 atlassian CNAMEs auto-deleted, breaking DKIM)
> is the reason the diff gate exists.

## Cloudflare proxy mode

After sync, in the Cloudflare dashboard for `golia.jp`:

- `sentori.golia.jp` → **Proxied (orange cloud)** — 3-segment, covered
  by Universal SSL. Will be wired to the marketing CF Pages project in
  Phase 12.
- `app.sentori.golia.jp`, `ingest.sentori.golia.jp`,
  `api.sentori.golia.jp`, `docs.sentori.golia.jp`,
  `cdn.sentori.golia.jp` → **DNS only (grey cloud)** so origin Caddy is
  reachable for ACME HTTP-01 challenges.

`status.sentori.golia.jp` — leave grey when added in Phase 16.

## Caddy site block — paste onto origin VM `t01`

Append to the Caddyfile on `t01` (the standard goliajp host already
runs Caddy with on-disk site blocks; if you keep all sites in one
Caddyfile the snippet goes there, otherwise drop it as
`/etc/caddy/conf.d/sentori.caddy`):

```caddy
app.sentori.golia.jp,
ingest.sentori.golia.jp,
api.sentori.golia.jp,
docs.sentori.golia.jp,
cdn.sentori.golia.jp {
    # Phase 11 placeholder. Phase 16 will replace this with
    # reverse_proxy to the actual containers/hosts:
    #   app.sentori     → web container :80
    #   ingest.sentori  → server :8080
    #   api.sentori     → server :8080
    #   docs.sentori    → docs-site container or CF Pages
    #   cdn.sentori     → static dir / R2
    respond "sentori — phase 11 placeholder" 503
}
```

Reload + watch ACME:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -f       # one ACME success line per subdomain
```

Caddy issues five LE certs on first resolution. Renewal is automatic
(~30 days before expiry).

## Verify

```bash
# DNS resolution
for n in sentori app.sentori ingest.sentori api.sentori docs.sentori cdn.sentori; do
  printf "%-25s -> %s\n" "${n}.golia.jp" "$(dig +short "${n}.golia.jp" | head -1)"
done

# TLS handshake — body 503 is fine, valid cert is the assertion
for n in app.sentori ingest.sentori api.sentori docs.sentori cdn.sentori; do
  echo "=== ${n}.golia.jp ==="
  curl -vIs "https://${n}.golia.jp" 2>&1 | grep -E '^[<*] (HTTP|SSL connection|subject:|issuer:)'
done

# 3-segment via CF
curl -vIs "https://sentori.golia.jp" 2>&1 | grep -E '^[<*] (HTTP|SSL connection)'
```

Expected: 4-segment names return 503 with a valid Let's Encrypt cert
issued for the exact name; `sentori.golia.jp` returns CF default error
page or whatever placeholder, but TLS handshake succeeds against
Universal SSL.

## Renewal

- `*.golia.jp` (covers `sentori.golia.jp`): Cloudflare Universal SSL,
  auto-renewed by Cloudflare.
- 4-segment subdomains: Caddy renews each LE cert automatically. No
  manual cron action expected.

## Phase-16 follow-up

When the actual backends come up:

1. Replace the `respond ... 503` block with `reverse_proxy` per
   subdomain (see commented map in the Caddyfile snippet above).
2. Add `status.sentori.golia.jp` CNAME → Better Stack status page.
3. (Optional) re-evaluate Cloudflare Advanced Cert if WAF/DDoS on the
   ingest path becomes worth $20/mo.

These steps live in Phase 16's deploy section; this file gets updated
when they ship.
