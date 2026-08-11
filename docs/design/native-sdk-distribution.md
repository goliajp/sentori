# How the native SDKs get to an app

Status: **design, 2026-08-12.** The code exists and is tested;
`sdk/native/{ios,android}` is not something anyone can `import`. This
decides what they import instead.

Written because insight's `/apps/insight` and `/apps/consumer` are
Swift and Kotlin with no React Native, and Sentori's only shipping
mobile surface is an npm package.

## What the constraints actually are

Measured, not assumed:

| | |
|---|---|
| `goliajp/sentori` | **public** — SwiftPM and JitPack can reach it |
| `.git` | **112 MB** |
| tracked files under `sdk/native` | 50 |
| Maven / CocoaPods publishing config | none |
| signing or Sonatype credentials | none |

And the one that decides the iOS shape: **a Swift package's manifest
must sit at the repository root.** Ours is at
`sdk/native/ios/Package.swift`, and SwiftPM cannot be pointed at a
subdirectory of a git dependency.

## iOS — a mirror repository

`Package.swift` moves to the root of a repository that contains only
the Swift package.

The alternative is putting `Package.swift` at this repo's root with
`path: "sdk/native/ios/Sources/Sentori"`, which does work. It also
means every consumer's `swift package resolve` clones 112 MB of
server, dashboard and example app to obtain twenty Swift files. That
is a cost paid by every integrator forever to save one workflow here.

So: **`goliajp/sentori-swift`**, holding `Package.swift`, `Sources/`,
`Tests/` and a README, synced from `sdk/native/ios` by CI on a release
tag. `sentori-selfhosted` already works this way and the mechanism is
understood.

```swift
.package(url: "https://github.com/goliajp/sentori-swift", from: "1.0.0")
```

The podspec stays. A pod can reference sources anywhere in its own
directory, so CocoaPods keeps working from this repo for hosts that
use it — and the React Native package's pod keeps compiling the
mirrored core exactly as it does now.

## Android — a standalone Gradle build, then Maven

`sdk/native/android` has sources and no build of its own: its tests
run only because they are mirrored into the React Native module and
executed by `android-unit`. That is the asymmetry noted in v1.6 S3,
and it is what the standalone build removes.

It needs `settings.gradle`, a root `build.gradle`, a wrapper, and a
`maven-publish` block. Then the artifact.

**Where it publishes is the one decision that is not mine**, because
it needs credentials and a namespace claim:

| | coordinates | what it needs | when |
|---|---|---|---|
| **Maven Central** | `jp.golia.sentori:sentori` | Sonatype account, `jp.golia` namespace verified by a DNS TXT record on golia.jp, a GPG key, two repository secrets | a day or so of setup, then automatic |
| **JitPack** | `com.github.goliajp.sentori:sentori` | nothing — it builds a public repo at a tag | immediately |

Maven Central is where an SDK belongs: the coordinates say who owns
it, and a consumer needs no extra repository line. JitPack works
today and says `com.github` in every integrator's build file.

Recommendation: Maven Central, with JitPack named in the docs as the
interim so insight is not blocked while the namespace verifies.

## Versioning

The native packages take their own version, starting at **1.0.0**.

Today they read the React Native package's number, because they
shipped together and one constant was easier than two. They are about
to stop shipping together — an iOS app has no opinion about the
React Native SDK's major — and a version that moves for reasons the
consumer cannot see is worse than a separate one. `sync-sdk-version`
gains a row for each; the tags are `swift/1.0.0` and `android/1.0.0`,
distinct from the existing `@goliapkg/…@x.y.z`.

## What stays a mirror, and for how long

The React Native package carries a byte-identical copy of the native
core because a pod cannot reach outside its own directory and npm will
not follow a symlink into a tarball. That does not change with
publication: the RN pod would otherwise depend on a published
`Sentori` pod, coupling every RN release to a native release for no
benefit the integrator can see.

The mirror is gated byte-for-byte in preflight and CI, so it is a
copy that cannot drift. It stays.

## Order of work

1. Android standalone Gradle build + `maven-publish`, its tests
   running in their own job rather than through the RN module.
2. `sentori-swift` mirror repo and the sync workflow, with a gate that
   the published package builds and tests from a clean checkout.
3. Docs: `docs/sdk-swift.md`, `docs/sdk-kotlin.md`, and an install
   section that names the real coordinates.
4. Example apps — a Swift one and a Kotlin one, built in CI. The RN
   example is what has caught real breakage; a snippet in a README
   catches none.
5. Release: both native packages at 1.0.0, the 32 unreleased commits
   to master, server and webapp, and the npm packages.

Each step lands with its gate, and each gate's red path is run before
the step is called done — including the one that would otherwise be
easy to skip here: **a clean-checkout build of the published package**,
because a package that only compiles inside this monorepo is not
published, it is described.
