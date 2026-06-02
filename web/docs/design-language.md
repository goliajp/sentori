# Sentori dashboard design language

The dashboard is dense, dark-default, keyboard-first. Reference points:
[Linear](https://linear.app), [Vercel](https://vercel.com),
[Modal](https://modal.com). **Not** Sentry / Datadog / GitLab.

## Type scale (px)

| Size  | Use                                            | Tailwind            |
|-------|------------------------------------------------|---------------------|
| **11**| Small caps labels, table headers, meta lines   | `text-[11px]`       |
| **12**| Compact rows, breadcrumbs, status chips        | `text-[12px]`       |
| **13**| Body / table rows                              | `text-[13px]`       |
| **14**| Default `text-sm`                              | `text-sm`           |
| **15**| Section bodies                                 | `text-[15px]`       |
| **16**| Large labels                                   | `text-base`         |
| **24**| Page titles (sparse)                           | `text-2xl`          |

Body text is 13px in lists. Headers are 11px uppercase tracking-wider.
Page titles use `text-base font-semibold`. Avoid 18/20/22 — they read
fragmented next to 13/16.

## Spacing scale (px)

| Step | Tailwind | Use                                            |
|------|----------|------------------------------------------------|
| 4    | `1`      | Inline gaps inside a row                       |
| 8    | `2`      | Tight stacks, inline icon-text                 |
| 12   | `3`      | Section internal padding                       |
| 16   | `4`      | Default gap between cards                      |
| 24   | `6`      | Page horizontal padding (px-6 = 24px)          |
| 32   | `8`      | Major section breaks                           |

Default page padding is `px-6`. Toolbar / row heights are `h-7` (28px),
`h-8` (32px), `h-12` (48px). Avoid 36/40/44 — break the rhythm.

## Row heights

| Height | Use                          | Tailwind |
|--------|------------------------------|----------|
| 28     | Table header                 | `h-7`    |
| 32     | Table body row               | `h-8`    |
| 48     | Top bar / page header        | `h-12`   |

## Numbers

All counts, durations, timestamps render with `tabular-nums`. UUIDs and
file paths use `font-mono`.

## Color palette

Tokens live in `src/index.css` as Tailwind v4 `@theme`. Dark is default
via `<html data-theme="dark">`; light falls back to the same names.

| Token             | Dark                | Light               | Use                              |
|-------------------|---------------------|---------------------|----------------------------------|
| `--color-bg`      | near-black          | white               | App background                   |
| `--color-bg-tertiary` | low-elev raised | gray-100            | Hover / muted surfaces           |
| `--color-fg`      | high-contrast text  | near-black          | Primary text                     |
| `--color-fg-muted`| low-contrast text   | mid gray            | Secondary text, table headers    |
| `--color-fg-secondary` | mid contrast   | mid-dark gray       | Tertiary content                 |
| `--color-border`  | subtle dark border  | subtle light border | All dividers and outlines        |
| `--color-accent`  | brand color         | same                | Active state, focus ring, links  |

Selected row uses `bg-accent/10`. Active filter chip uses
`bg-accent/10 text-accent`. Errors use `text-red-400` (don't theme it
into a token; errors are global).

## Keyboard shortcuts

Global per-view, not app-wide:

| Key       | Action                        | Scope             |
|-----------|-------------------------------|-------------------|
| `j` / `k` | Move selection down / up      | IssueListView     |
| `Enter`   | Open selected issue           | IssueListView     |
| `s`       | Silence selected active issue | IssueListView     |
| `/`       | Focus the search box          | IssueListView     |
| `[` / `]` | Step events                   | IssueDetailView   |
| `Esc`     | Back to list                  | IssueDetailView   |

## What we don't do

- No box shadows on cards. Borders only.
- No gradients or illustrations.
- No emoji in UI strings.
- No animations beyond hover transitions and fade-ins; no spinners
  longer than ~250 ms (use skeletons or just text "Loading…").
- No nesting deeper than ~3 levels of background tone (`bg`,
  `bg-tertiary`, plus borders for depth).
- No fonts beyond the system stack and a single mono fallback.
