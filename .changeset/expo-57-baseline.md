---
'@goliapkg/sentori-react-native': minor
'@goliapkg/sentori-expo': minor
---

Track the current Expo SDK, and declare a peer range that contains it

6.0.0 declared `expo-modules-core >=56.0.0 <57.0.0`. This repo built
and tested against 55.0.25, and the current Expo SDK ships 57. Nothing
occupied that window — not our own example app, not a new user's
project. `npm install @goliapkg/sentori-expo` answered ERESOLVE and
installed nothing, which is the hardest possible way to fail the one
thing this SDK has to be.

Nothing was watching. peerDependencies are strings that no build step
reads, and the example app is wired with `workspace:*`, so it never
resolved the published range at all.

The baseline is now the latest stable Expo, and stays there:

| | was | now |
|---|---|---|
| expo | 55.0.24 | 57.0.12 |
| react-native | 0.83.6 | 0.86.2 |
| react | 19.2.0 | 19.2.3 |
| expo-modules-core (resolved) | 55.0.25 | 57.0.10 |

Peer ranges now say what we actually build against — `expo-modules-core
>=57.0.0`, `expo >=57.0.0`, `react-native >=0.86.0`. **This raises the
floor**: Expo 55 and 56 are no longer declared supported. They were not
tested at any point, and 6.0.0 could not be installed on 57 regardless.

`@goliapkg/sentori-expo` also drops its `expo-application` peer. It
never imported the module — the host passes it in and the SDK reads a
structural type, which is deliberate and documented in `index.ts`. An
optional peer for something we never require is a claim with nothing
behind it, and the new gate below is what noticed.

`scripts/check-peer-ranges.mjs` asserts every declared peer range
contains the version this repo installs, and fails when a peer is
declared that nothing here installs at all. It refuses range syntax it
cannot parse rather than passing it — a range a checker cannot read is
one it must not bless.
