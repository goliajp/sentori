---
"@goliapkg/sentori-react-native": minor
---

v2.18 — `expo-notifications` drop-in shim at `@goliapkg/sentori-react-native/expo-compat`.

90% drop-in. Customers migrating from `expo-notifications` change
ONE line:

```diff
- import * as Notifications from 'expo-notifications'
+ import * as Notifications from '@goliapkg/sentori-react-native/expo-compat'
```

…and the rest of their client-side code keeps compiling. Type
shapes (`Notification` / `NotificationResponse` /
`NotificationContent` / `NotificationRequest`) match
`expo-notifications` byte-for-byte; constants
(`AndroidImportance` / `IosAuthorizationStatus` /
`DEFAULT_ACTION_IDENTIFIER` / `SchedulableTriggerInputTypes`) are
re-exported with identical values; the listener registry +
1 Hz drain loop mirror the upstream's event semantics.

**Covered today** (just-works after the import swap):

* `getPermissionsAsync` / `requestPermissionsAsync` (incl. iOS
  sub-options — `allowProvisional` falls back to regular auth, with
  a debug-log note)
* `getDevicePushTokenAsync` (raw APNs / FCM token)
* `getExpoPushTokenAsync` (returns native token wrapped in the same
  envelope shape; **server-side change required** — POST to Sentori
  ingest instead of exp.host)
* `addNotificationReceivedListener` (foreground)
* `addNotificationResponseReceivedListener` (tap)
* `addPushTokenListener` (rotation)
* `setNotificationHandler` (handler runs; presentation-override
  flags are a follow-up)
* `unregisterForNotificationsAsync`

**Throws today** (each error message points at the recipe section
that documents the workaround):

`scheduleNotificationAsync` + 7 trigger types · `setBadgeCountAsync`
/ `getBadgeCountAsync` · `setNotificationChannelAsync` + channel
groups · `setNotificationCategoryAsync` + interactive actions ·
`useLastNotificationResponse` / `getLastNotificationResponseAsync` ·
`subscribeToTopicAsync` / `unsubscribeFromTopicAsync` ·
`registerTaskAsync` · `dismissNotificationAsync` /
`dismissAllNotificationsAsync` / `getPresentedNotificationsAsync`

The unsupported list is the follow-up minor backlog — every entry
needs a native module surface we don't have yet, but nothing here
is a permanent gap.

**Server-side migration** documented in the recipe at
`docs-site/src/content/docs/recipes/migrate-from-expo-notifications.md`
— covers the `exp.host` → Sentori ingest swap, the device-token
shape change (`ExponentPushToken[...]` → `ipt_<uuid>`), and the
credential upload flow.

**Coexistence** — `expo-notifications` AND
`@goliapkg/sentori-react-native/expo-compat` can run side-by-side in
the same app; they register separately with the OS push service.
Useful for a 1-week cut-over where you compare delivery rates.

**Compatibility** — additive subpath export. The existing
`sentori.push.*` namespace is unchanged. Wire shape with
`/v1/push/*` is the same as v2.7–v2.12 Push series.
