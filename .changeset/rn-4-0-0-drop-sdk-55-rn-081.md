---
'@goliapkg/sentori-react-native': major
---

Drop Expo SDK 55 / React Native 0.81 support; require Expo SDK 56+
or bare RN 0.82+.

Cascade from `@goliapkg/sentori-expo@8.0.0` (drops Expo SDK 55) so
the Sentori React Native SDK matrix is aligned on a single Expo SDK
version. Insight, our primary dogfood user, is on RN 0.85.3 (Expo
SDK 56 environment), and the support window moves to match.

**Peer range tightening:**

| Peer | 3.x | 4.0.0 |
|---|---|---|
| `expo-modules-core` | `">=55.0.0 <57.0.0"` | `">=56.0.0 <57.0.0"` |
| `react-native` | `">=0.81.0"` | `">=0.82.0"` (Expo 56 pins RN 0.82) |
| `react` | `">=19"` | unchanged |

**For Expo SDK 55 hosts or bare RN 0.81 hosts**: pin
`@goliapkg/sentori-react-native@^3.1.0`. The 3.x line continues to
receive critical-bug backports.

**No runtime API change.** Every public surface (`sentori.init`,
`captureException` / `captureMessage`, span / trace APIs,
`recordMetric`, breadcrumbs, native crash handlers, push registration,
session-trail / replay capture, fetch + react-navigation tracing)
behaves identically on the new peer range. The native iOS / Android
modules use only APIs stable on Expo modules-core 56.x.

**Companion package not bumped automatically:**
`@goliapkg/sentori-expo@8.0.0` declares
`@goliapkg/sentori-react-native: ">=3.1.0"`, so Expo 56 hosts can run
either RN SDK 3.x or 4.x (both satisfy the peer). For new
installations on Expo 56 we recommend pinning RN SDK 4.x for the
narrower-and-more-explicit Expo 56 support window.
