# Sentori Design Tokens

> **Single source of truth** for the colour / typography palette used across
> the dashboard (React + Tailwind), the marketing site (Astro + Tailwind),
> and the docs site (Astro Starlight). Native SDKs use platform-native
> palettes — these tokens are web-only.

Phase 28 sub-F (2026-05-10) locks the values below. Three CSS files
mirror them by hand:

- `web/src/index.css` — dashboard, supports light + dark
- `marketing/src/styles/global.css` — marketing, dark-only
- `docs-site/src/styles/overrides.css` — docs, Starlight overrides

Values are duplicated rather than imported because each surface ships
its own bundle and a shared CSS package would force a publish loop on
every tweak. We accept the duplication and reconcile via this doc:
**any token change must update all three files plus the table below in
the same PR.**

## Palette

### Light theme (dashboard only — marketing and docs are dark-only)

| Token                   | Value     | Used for                                          |
|-------------------------|-----------|---------------------------------------------------|
| `--color-bg`            | `#ffffff` | page background                                   |
| `--color-bg-tertiary`   | `#f3f4f6` | inputs, buttons, card backgrounds                 |
| `--color-fg`            | `#111827` | primary text                                      |
| `--color-fg-secondary`  | `#374151` | hover states, slightly de-emphasized text         |
| `--color-fg-muted`      | `#6b7280` | metadata, timestamps, secondary labels            |
| `--color-border`        | `#e5e7eb` | hairline dividers, input borders                  |
| `--color-accent`        | `#6d28d9` | primary buttons, focus rings, links               |

### Dark theme (the default — marketing and docs are dark-only)

| Token                   | Value     | Used for                                          |
|-------------------------|-----------|---------------------------------------------------|
| `--color-bg`            | `#0b0b0f` | page background                                   |
| `--color-bg-tertiary`   | `#1a1a23` | inputs, buttons, card backgrounds                 |
| `--color-fg`            | `#f3f4f6` | primary text                                      |
| `--color-fg-secondary`  | `#d1d5db` | hover states, slightly de-emphasized text         |
| `--color-fg-muted`      | `#9ca3af` | metadata, timestamps, secondary labels            |
| `--color-border`        | `#2a2a35` | hairline dividers, input borders                  |
| `--color-accent`        | `#a78bfa` | primary buttons, focus rings, links               |

### Status colours

These are Tailwind palette references, not CSS variables — the dashboard
already uses `bg-red-500/15 text-red-300` style classes inline. The list
exists so we keep the meaning consistent across surfaces.

| Semantic          | Tailwind class fragment           | Used for                                |
|-------------------|------------------------------------|-----------------------------------------|
| Success / healthy | `green-500/15` `green-300`         | crash-free rate ≥ threshold             |
| Warning           | `amber-500/15` `amber-300`         | active issues, ANR, snooze chip         |
| Danger / error    | `red-500/15` `red-300`             | regressed issues, crashed sessions      |
| Info              | `blue-500/15` `blue-300`           | nav/projects in Cmd+K, snoozed chip     |
| Neutral / mute    | `bg-bg-tertiary` `text-fg-muted`   | closed / silenced state                 |
| Distinct (member) | `violet-500/15` `violet-300`       | user references in Cmd+K                |

## Typography

| Token / Style             | Value                                                             |
|---------------------------|-------------------------------------------------------------------|
| Sans family               | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| Mono family               | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`                          |
| Dashboard body            | 14px / line-height 1.5 (set on `body`)                            |
| Marketing body            | 15px / line-height 1.55                                           |
| Docs body                 | `--sl-text-base: 14.5px` (Starlight token)                        |
| Tabular numbers           | always `tabular-nums` for IDs, counts, durations, timestamps      |

## Density

The dashboard ships a runtime density toggle (Phase 24 sub-E). Tokens
live in `web/src/lib/density.ts` not in CSS — they're per-component
Tailwind class fragments because each table picks which slots it
cares about (row height vs cell padding-y vs text size).

| Token (compact)       | Token (cozy)             |
|-----------------------|--------------------------|
| `h-7 + text-[12px]`   | `h-10 + text-[13px]`     |
| `py-0.5`              | `py-1.5`                 |

## Hard rules

- **No raw hex colours in component code.** If you find yourself
  reaching for `#a78bfa` inline, that's a token leak — add the value
  to the table above (or use the existing accent token) and reference
  the variable.
- **No new font families.** Two families is enough for v0.2; system
  defaults match the design language.
- **`prefers-reduced-motion: reduce` is respected** — see
  `web/src/index.css`. Don't add `transition` / `animation` that bypasses
  this rule.
- **Status colour semantics are one-way.** Green is healthy; red is
  unhealthy. Don't reuse green for "neutral state" — pick the muted
  palette instead.
