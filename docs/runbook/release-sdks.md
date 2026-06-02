# Release SDKs

> How to ship a new version of one or more `@goliapkg/sentori-*` packages.
> Companion to [`deploy.md`](./deploy.md) — that's the server/dashboard;
> this is the npm packages.

We use **[Changesets](https://github.com/changesets/changesets)** for
versioning + changelog. The same flow React Native CLI, Astro, Vite,
tRPC and Remix use. Two rules:

1. **Every code change to an SDK package gets a changeset.** No
   undocumented bumps.
2. **No empty bumps.** If a package wasn't touched, it doesn't move.
   `bunx changeset version` enforces this — only packages with pending
   changesets get bumped.

## Day-to-day: while developing

After you finish a change that touches one or more SDK packages:

```bash
bunx changeset add
```

You'll be prompted to:

- Pick which package(s) the change affects (space to multi-select)
- Pick bump type per package: **patch** (bugfix) / **minor** (additive
  feature, no breakage) / **major** (breaking change)
- Write a one-line summary — this is the line that shows up in the
  package's `CHANGELOG.md`

It writes a `.changeset/<random-name>.md` file. **Commit it alongside
the code change** in the same PR. Don't batch up changesets at release
time — write them when the context is fresh.

### Bump type quick reference

| Type | When | Example |
|---|---|---|
| **patch** | Bugfix, no API change | "fix Android wireframe walker recursing through zero-size wrappers" |
| **minor** | New optional API, new feature, no breakage | "add `sentori.captureWireframe()` standalone helper" |
| **major** | Removed/renamed API, changed default, changed required param | "rename `dsn` → `token`, drop `dsn` shim" |

When in doubt, **patch**. We can always re-cut a minor if needed.

## Release day: cut a version

From a clean `main`, all changes merged:

```bash
git checkout main && git pull
bun run check                       # lint + tsc + tests
bun run build:sdks                  # build all SDK packages

bunx changeset version              # applies pending changesets:
                                    #   - bumps each affected package's version
                                    #   - writes each package's CHANGELOG.md
                                    #   - deletes the consumed .changeset/*.md
                                    # (root CHANGELOG.md is unaffected — it's
                                    # for cross-package narrative history)

git add . && git commit -m "release: bump SDK versions"
git push origin master              # wait for CI green before publish

bunx changeset publish              # npm publish for every bumped package
                                    # + creates `@goliapkg/sentori-<pkg>@<ver>` git tags
git push --tags
```

### Verify

```bash
# spot-check on npm:
npm view @goliapkg/sentori-react-native versions --json | tail -5
npm view @goliapkg/sentori-core versions --json | tail -5
```

Then run the [post-publish smoke test](./v1.0-fresh-deploy.md) on
`apps/rn-example/` to confirm the published packages install + boot
cleanly.

## When a publish fails halfway

`changeset publish` publishes packages one at a time. If it dies mid-way
(npm 5xx, auth, network), some packages will already be on the registry.

- **Don't unpublish.** npm policy + cache makes that messy.
- Re-run `bunx changeset publish` — it skips packages already on the
  registry at that version.
- If a package is on the registry but the git tag is missing, push the
  tag manually: `git tag @goliapkg/sentori-<pkg>@<ver> && git push --tags`.

## Versioning policy

- **Independent semver per package.** RN being on 1.x doesn't force
  `core` to 1.x. Cross-package compat goes through caret peerDeps
  (`"@goliapkg/sentori-core": "^0.8.0"`).
- **Pre-1.0 packages** (`solid`, `svelte`, `vue`, `expo`, `next`) signal
  "API surface may still shift". Breaking changes go into a minor bump
  (semver allows this pre-1.0). Document them in the changeset summary.
- **1.0+ packages** (`react-native`, post-W6 audit) follow strict semver.
  Breaking changes require a major bump and a migration note in the
  changeset summary.
- **Root `package.json` has no `version`.** It's a private monorepo
  marker, never published. Don't add one back.
