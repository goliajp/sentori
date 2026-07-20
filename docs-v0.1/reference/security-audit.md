# Security audit — `cargo audit` posture

Run on 2026-06-21 against v0.1.0 RC1.

## Summary

| Workspace | Vulnerabilities | Fixed in this ship |
|---|---|---|
| `core/` | 1 (unfixable transitive) | 0 |
| `self-hosted/server/` | 1 (unfixable transitive) | 1 (time DoS) |
| `saas/server/` | 1 (unfixable transitive) | 1 (time DoS) |
| `self-hosted/cli/` | 1 (unfixable transitive) | 1 (time DoS) |

## Fixed: `time` DoS via stack exhaustion (RUSTSEC-2026-0009, medium 6.8)

Pinned each Cargo.lock to `time 0.3.49+` (was 0.3.45 in
the three binary lockfiles; core/ was already at 0.3.49
via the workspace dep resolution).

Rust toolchain pin bumped 1.85 → 1.88 across all four
manifests + GitHub Actions + both Dockerfiles. 1.88 is
required by time 0.3.49. No 2024-edition features
affected.

## Remaining: `rsa 0.9.10` Marvin Attack (RUSTSEC-2023-0071, medium 5.9)

**No upstream fix available.** rsa pulls into the
workspace transitively via `sqlx-mysql` (sqlx's macro
crate currently builds all backend support regardless of
the `features = [...]` selection at use site).

Status: **unreachable from any Sentori code path.**

Why:
- We do not call into `rsa` directly anywhere in the
  workspace.
- We never enable the `sqlx::features = ["mysql"]` —
  workspace pins `features = ["runtime-tokio",
  "postgres", "uuid", "time", "json"]`.
- The vulnerability requires actually performing RSA
  decryption with the affected impl; our call paths
  never touch it.

Mitigation: tracked under issue (TODO file) for a future
sqlx upstream fix or `sqlx-postgres` standalone migration
(would remove the mysql + sqlite + macros transitive
graph). Lower priority because the path is dead.

## Cryptography choices that prevented other vulns

The workspace deliberately picks libraries to avoid
common RustSec advisories:

| Use | Picked | Avoided |
|---|---|---|
| JWT signing | `jsonwebtoken` with `aws_lc_rs` backend | `rsa` crate (RUSTSEC-2023-0071) |
| EdDSA | `ed25519-dalek` | n/a |
| Symmetric AEAD | `aes-gcm` (RustCrypto) | OpenSSL bindings |
| Password hash | `argon2 = "0.5"` | bcrypt + custom KDF |
| TLS in reqwest / lettre | `rustls` + `webpki-roots` | native-tls / OpenSSL |

## CI policy

`cargo audit` runs are NOT yet enforced as a hard CI
gate (would block on the unfixable rsa false positive).
Plan for v0.1.x: add `cargo audit --ignore RUSTSEC-2023-0071`
to the `v0.1-core.yml` workflow so genuine new vulns
fail CI but the known false positive doesn't.

## Reporting new vulns

See `.github/SECURITY.md`. Email **security@golia.jp**;
PGP key TBD.
