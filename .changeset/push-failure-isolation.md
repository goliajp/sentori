---
'@goliapkg/sentori-react-native': patch
---

Nothing the host does inside a push handler can reach back into the app.

The handlers are the host's own code running inside our loop, and one
that threw used to take the rest of the batch with it, then the tick,
then every later tick as an unhandled rejection. A throwing `onToken`
reported a successful registration as a failure, and a throwing
`onError` made `register()` reject — breaking the one contract it
documents.

The iron rule's gate covered the five event verbs and mentioned push
nowhere. It does now: a server that answers 500, nonsense or nothing,
a native module that throws, and garbage passed to every push verb.
