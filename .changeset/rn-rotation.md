---
'@goliapkg/sentori-react-native': minor
---

A rotated vendor token no longer moves the device's address.

Registration from this package was keyed on the vendor's token alone,
so when the token rotated the server wrote a new row under a new
spToken and every backend holding the old one was addressing nothing.
Both native layers already routed a rotation into the native SDK,
which declines to act on a device the native side never registered —
which, for a React Native app, is every device.

Registration now carries an installId, and the drain loop that already
runs at 1 Hz reports a token it has not seen before. Foreground only,
once per token, and a failed report is retried on the next change
rather than silencing every later one.
