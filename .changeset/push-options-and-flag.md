---
'@goliapkg/sentori-react-native': minor
'@goliapkg/sentori-expo': minor
---

Two dead push options, and a `push: false` switch for the config plugin

`PushRegisterOptions.linkHash` is gone. It targeted a column migration
0012 removed, nothing read it, and its doc comment still called it the
way the server reaches a specific user across their devices — so a host
that followed the comment instead of calling `sentori.user()` got a
successful registration that was never addressable, with nothing
reporting why.

`PushRegisterOptions.metadata` now works. It reached neither the
request body nor the server, while `device_tokens.metadata` sat at
`{}` since the table was created. It is stored, kept across
re-registration when a later call omits it, and shown per device in
Settings ▸ Push — needs server ≥ 2.22.0.

`@goliapkg/sentori-expo` accepts `push: false`, which removes our
`FirebaseMessagingService` from the merged Android manifest so
`expo-notifications` can own delivery. Set it per EAS profile when only
some environments use Sentori push. Error and performance capture are
unaffected; this switches delivery, not the SDK.
