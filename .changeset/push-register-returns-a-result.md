---
'@goliapkg/sentori-react-native': major
---

`sentori.push.register()` never throws

A denied push permission is an ordinary answer, not an exception. An
opt-in that throws inside someone's `useEffect` is precisely the
failure this SDK's contract with its host app is written against, and
this was the one place in the SDK that did it.

`register()` now resolves to a discriminated union — there is no
`catch` branch left to forget:

```ts
const r = await sentori.push.register()
if (r.ok) use(r.ipt)
else switch (r.reason) { /* ... */ }
```

`reason` is one of `permission-denied`, `no-transport`,
`token-timeout`, `server-rejected`, `not-initialised`. Each asks the
host for something different, which is the only reason to distinguish
them — a declined permission should never be retried on a timer, while
a token timeout reasonably should.

Two of those were one branch until now: a missing native module
reported itself as a denied permission, so an Expo Go build and a user
tapping "Don't Allow" produced the same message.

**Breaking**: the resolved value was `{ ipt }` and is now
`{ ok: true, ipt } | { ok: false, reason, message }`. Destructuring
`const { ipt } = await register()` no longer type-checks.

Also in this release: the first tests this package has ever had for
push. There were none, which is how three unbalanced INSERTs on the
server and two wrong field names in this file went a year without
anyone noticing that registration had never once succeeded.
