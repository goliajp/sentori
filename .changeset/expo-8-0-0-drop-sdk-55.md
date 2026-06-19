---
'@goliapkg/sentori-expo': major
---

Drop Expo SDK 55 support; require Expo SDK 56+.

The Insight team — our primary dogfood user — is on Expo SDK 56, and
Sentori's published-package range moves to match. Aligning the
support window on a single Expo SDK simplifies the build matrix for
hosts and removes the "which Expo do you need / which sentori-expo
do you need" question entirely.

**Peer range tightening (all breaking for Expo 55 hosts):**

| Peer | 7.x | 8.0.0 |
|---|---|---|
| `expo` | `">=55.0.0 <57.0.0"` | `">=56.0.0 <57.0.0"` |
| `expo-application` | `">=55.0.0 <57.0.0"` | `">=56.0.0 <57.0.0"` |
| `react-native` | `">=0.81.0"` | `">=0.82.0"` (Expo SDK 56 pins RN 0.82) |
| `@expo/config-plugins` (dependency) | `">=55.0.0 <57.0.0"` | `"^56.0.9"` |

**Not touched:** `@goliapkg/sentori-react-native` peer stays at
`">=3.1.0"`. The RN SDK itself remains usable on Expo 55 hosts that
don't enable the `@goliapkg/sentori-expo` config plugin (e.g. hosts
using sentori only for error/span/replay capture). Hosts that want
the push config-plugin auto-wiring need Expo SDK 56.

**For hosts staying on Expo SDK 55**: pin
`@goliapkg/sentori-expo@^7.0.2`. The 7.x line continues to receive
critical-bug backports but does not get new features.

**No runtime API change** in `@goliapkg/sentori-expo` itself. Every
public plugin (`withSentori`, `withSentoriNSE`, `withSentoriNSETarget`,
`withSentoriPushIos`, the Android trio, `withSentoriGoogleServicesJson`)
behaves identically against the new peer range. The 7.0.2 NSE target
auto-injection + Info.plist version sync work ships unchanged.
