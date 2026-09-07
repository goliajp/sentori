# Deploy

Deploys are automatic. Pushing a `release/*` branch deploys production; so does a green `build` on `master`. Nobody SSHes anywhere, and there is no image to pull by hand.

> This runbook was rewritten on 2026-09-08 against `.github/workflows/deploy.yml`. The previous version described tagging on `main`, pulling a GHCR image, and rolling `server-blue` / `server-green` one at a time behind a `lb_policy ip_hash` Caddy. None of that is how it works: the branch is `master`, the image is built on the runner rather than pulled, and there is one server container. Every command in it would have failed, most of them against a `production-compose.yml` that does not exist.

## What actually happens

`deploy.yml` runs on the self-hosted `lx64` runner and:

1. Checks out the triggering SHA. For a `workflow_run` deploy it pins `github.event.workflow_run.head_sha` — the default branch HEAD is *not* what went green.
2. Builds the webapp and rsyncs it to the bind-mounted dist dir, then rsyncs source to `/apps/sentori/src/`.
3. Installs the compose file from a fresh `goliajp/devops` checkout (`services/sentori/docker-compose.yml`), falling back to the copy in the rsynced source.
4. Writes `/apps/sentori/.env` from repo secrets, mode 600.
5. `docker compose build server-v1` then `up -d postgres-v1 server-v1`. The image is **built on the runner** — there is no registry pull in this path.
6. Smokes against `http://127.0.0.1:18092`, and the last assertion is the one that matters:

   ```
   want = the version in this checkout
   got  = the "version" field /healthz answered with
   test "$want" = "$got"
   ```

   A 200 from a stale binary answers "healthy?" exactly like a fresh one. Only the version field proves the deploy shipped. (Same reason the smoke also asserts `/auth/me` → 401 and `/login` → 200: a server that boots but serves no dashboard is not a successful deploy.)
7. On the `release/*` path only, tags `v<X.Y.Z>` and pushes it.

Concurrency group `deploy-lx64-sentori`, `cancel-in-progress: false` — deploys queue rather than clobber each other.

## Cutting a release

Sentori runs strict git-flow and opens no PRs: work lands on `develop`, a `release/<X.Y.Z>` branch cuts the version, and `master` only ever receives merges. The full sequence, and the two places it bites:

```sh
git checkout develop && git pull
git checkout -b release/<X.Y.Z>

# The version lives in four files and they move together:
echo <X.Y.Z> > VERSION
sed -i '' 's/^version = "<old>"/version = "<X.Y.Z>"/' self-hosted/server/Cargo.toml
node scripts/gen-openapi.mjs                    # info.version tracks VERSION
(cd self-hosted/server && cargo check --quiet)  # refreshes Cargo.lock
# then write the CHANGELOG entry by hand

bun run preflight                               # the only gate before a release push
git add VERSION CHANGELOG.md self-hosted/server/Cargo.toml \
        self-hosted/server/Cargo.lock self-hosted/server/openapi.json
git commit -m "release: <X.Y.Z> — <one line>"
git push -u origin release/<X.Y.Z>              # ← this deploys production
```

**`release/*` runs no checks before deploying.** `build.yml` does not fire on it — only `deploy.yml` does. Local `preflight` is the whole gate, so run it before the push, not after.

**Do not tag by hand on release finish.** `deploy.yml` already tagged and pushed `v<X.Y.Z>` in step 7. `git tag -a` then fails with "already exists", and because it sits mid-`&&` in the documented sequence it swallows the `git push origin master` after it, leaving master local and looking finished. Merge and push, then fetch the tag CI made:

```sh
git checkout master && git pull
git merge --no-ff release/<X.Y.Z> -m "Merge branch 'release/<X.Y.Z>'"
git push origin master
git fetch origin --tags
git checkout develop && git pull
git merge --no-ff release/<X.Y.Z> -m "Back-merge release/<X.Y.Z> into develop"
git push origin develop
```

The master push runs `build.yml`, and a green build triggers `deploy.yml` again through `workflow_run`. That second deploy is expected and idempotent — it redeploys the same version.

## Pre-flight

1. `bun run preflight` green. It is the same set the CI gates run, plus the ones CI does not have.
2. New migration? It ships inside the binary: `sqlx::migrate!("../../core/migrations")` embeds them **at compile time**, and `main.rs` runs them at boot. Confirm it is idempotent — it re-applies on every restart of every self-hosted install.
3. Note the version you are coming from: `curl -s https://sentori.golia.jp/healthz` and read `version`.

## Verifying a deploy

```sh
curl -s https://sentori.golia.jp/healthz
```

Read the `version` field, not the status code. `{"status":"ok","db":"ok","version":"<X.Y.Z>", ...}` with the version you just shipped is the only proof. Then `gh run list --branch master --limit 8` — the master line fans out to seven workflows, and `deploy` arrives last via `workflow_run`.

## Rollback

There is no version-pinned rollback switch: the deploy builds from source on the runner, so "the previous version" means "that commit, deployed again."

- **Fastest**: `gh workflow run deploy.yml --ref <previous release branch or SHA>`. The workflow accepts `workflow_dispatch`.
- **Otherwise**: revert on `develop`, cut the next patch release, and let the normal path deploy it. Slower, but it leaves the branch history honest.

Either way, verify with the `version` field afterwards.

## Migration safety

Never ship a destructive migration (drop column, drop table, narrowing constraint) in the same image as code that requires the new shape. Stage it:

1. Release N: code **tolerates** both shapes; migration adds the new one.
2. Release N+1: code **requires** the new shape; migration drops the old one.

Leave at least one full backup cycle (24h) between them so a rollback has somewhere to land. If a migration has applied and you roll back to code that predates it, going **forward** with a fix is the only safe move — do not hand-edit production schema.
