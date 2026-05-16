# Pinned dependencies — single source of truth

Most deps run on a latest-stable line (see `package.json` /
`Cargo.toml`). This file lists every dep we **deliberately hold
back from latest** and the reason. Re-check on each polish sprint;
when the trigger fires, upgrade and remove the entry.

## Cargo (server + cli)

### `argon2 = "0.5"`, `hmac = "0.12"`, `sha2 = "0.10"`, `rand = "0.8"` — RustCrypto bundle

**Latest available:** `hmac 0.13`, `sha2 0.11`, `rand 0.10`.

**Why held:** Trying to upgrade `hmac → 0.13` / `sha2 → 0.11` / `rand
→ 0.10` pulls in `crypto-common 0.2`. But `argon2 0.5` still transitively
depends on `crypto-common 0.1` (via its `password-hash 0.5` dep). The
two versions in the dep graph cause `Hmac<Sha256>: KeyInit` to fail
to resolve — the `Sha256` from `sha2 0.11` and the `KeyInit` trait
referenced inside `Hmac<>` come from different crypto-common copies.

Bumping `argon2` to its next major would unblock this, but at the
time of writing argon2 hasn't published a release tracking the
RustCrypto 2026 majors.

**Trigger to upgrade:** `argon2 ≥ 0.6` released with `password-hash ≥
0.6` that uses `crypto-common 0.2`. At that point bump all four
together (hmac, sha2, rand, argon2).

**Where consumed:**
- `hmac` — `src/session.rs`, `src/webhook.rs`,
  `src/integrations/linear.rs` (HMAC-SHA-256 signatures)
- `sha2` — `src/grouping.rs`, `src/auth.rs`, `src/api/releases.rs`
  (fingerprint hashes + dSYM digest)
- `rand` — `src/api/user_auth.rs`, `src/api/tokens.rs`,
  `src/api/integrations.rs` (token / nonce / state generation)
- `argon2` — `src/passwd.rs` (password hashing)

### Cargo packages on latest

These were all bumped this sprint:
- `lettre 0.11.22`, `metrics 0.24.6`, `reqwest 0.13.3`, `redis 1.2.1`,
  `axum-extra 0.12.6`, `metrics-exporter-prometheus 0.18.3`,
  `addr2line 0.26.1`, `object 0.39.1`, `maxminddb 0.28.1`

## NPM (workspace)

### `@expo/config-plugins: "^9 || ^10"` in `sdk/expo`

**Latest available:** `^55` (versioning re-baselined when Expo
adopted SDK-version-aligned numbers).

**Why held:** Bumping to ^55 requires Expo SDK 53+ at the host. Our
`sdk/expo` declares `peerDependencies.expo: ">=50"` — moving to 55
would drop Expo SDK 50/51/52 hosts. `sdk/expo` isn't actively shipping
yet (v0.1.1, no Insight integration), so the support floor is a
product decision rather than a code one.

**Trigger to upgrade:** First active customer integration on
`sdk/expo` is on Expo SDK 53+. At that point: bump peer `expo: ">=53"`
and `@expo/config-plugins: "^55"` together.

### Internal monorepo deps

Internal `@goliapkg/sentori-*` references are pinned to the latest
**published** version (not workspace HEAD) so a `bun install` from a
clean checkout resolves consistently. The numbers in
`sdk/*/package.json` should track each subpackage's most recent npm
publish; sync them whenever you publish.

Current state (as of this sprint):
- `@goliapkg/sentori-core` → `0.8.2`
- `@goliapkg/sentori-javascript` → `0.4.3`
- `@goliapkg/sentori-react` → `0.4.7`
- `@goliapkg/sentori-react-native` → `0.9.5`

## Process

1. Quarterly: `bun outdated` per package + `cargo outdated`.
2. Patch + minor: bump in batch, run tests, ship.
3. Major: read changelog, prototype the migration. If migration
   blocks on something outside our control (RustCrypto cohort,
   Expo SDK floor decision, peer dep matrix), record here with a
   clear trigger.
4. Don't pin without a reason. "Worked before, scared to touch"
   isn't a trigger — bump it and see what breaks.

## Anti-patterns to avoid

- Pinning `~1.2.3` (patch-only) on a library we control the upgrade
  cadence for. Use `^1.2.3` and rely on the lockfile.
- Pinning to *avoid* doing the migration. Write the migration plan
  in this file, not the avoidance.
- Holding back a security-relevant dep (TLS, HTTP, crypto) just
  because the API churned. Migrate.
