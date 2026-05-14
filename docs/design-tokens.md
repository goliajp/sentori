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
| `--color-bg-secondary`  | `#fafafa` | card surfaces that need a slight lift             |
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
| `--color-bg-secondary`  | `#11121a` | card surfaces that need a slight lift             |
| `--color-bg-tertiary`   | `#1a1a23` | inputs, buttons, card backgrounds                 |
| `--color-fg`            | `#f3f4f6` | primary text                                      |
| `--color-fg-secondary`  | `#d1d5db` | hover states, slightly de-emphasized text         |
| `--color-fg-muted`      | `#9ca3af` | metadata, timestamps, secondary labels            |
| `--color-border`        | `#2a2a35` | hairline dividers, input borders                  |
| `--color-accent`        | `#a78bfa` | primary buttons, focus rings, links               |

### Status / semantic colours (Phase 49 sub-A)

Real CSS variables — paired text / bg / border triples per variant.
The `<InfoBox variant>` primitive in `web/src/components/ui/InfoBox.tsx`
and the `<Chip tone>` primitive both consume these directly. Use them
instead of `bg-red-500/15 text-red-300`-style ad-hoc Tailwind so a
future palette tweak only touches the token table.

| Semantic | Token triple                                                              | Used for                                          |
|----------|---------------------------------------------------------------------------|---------------------------------------------------|
| Info     | `--color-info` / `--color-info-bg` / `--color-info-border`                | hints, "this is how it works", nav highlights     |
| Success  | `--color-success` / `--color-success-bg` / `--color-success-border`       | crash-free rate ≥ threshold, opt-in is on         |
| Warning  | `--color-warning` / `--color-warning-bg` / `--color-warning-border`       | ANR, unsymbolicated, snooze chip, parser warnings |
| Danger   | `--color-danger` / `--color-danger-bg` / `--color-danger-border`          | regressed issues, crashed sessions, fetch errors  |

Light values are mid-tone-on-pale-tint; dark values are pale-tone-on-deep-tint —
both pass WCAG AA on the dashboard's background colours.

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
