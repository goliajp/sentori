---
'@goliapkg/sentori-react-native': patch
---

Fix Android build break on the Kotlin K2 compiler (Expo SDK 56).

`SentoriModule.kt` used a bare `return@Function` inside no-argument
`Function {}` lambdas (`pushRegister`, `pushUnregister`). Under K2 these
bind to the no-arg overload whose body is typed `() -> Any?`, where a bare
`return` is inferred as `Unit` and rejected:

```
e: SentoriModule.kt: Return type mismatch: expected 'Any?', actual 'Unit'.
```

This was a hard compile error that failed `:compileDebugKotlin` and blocked
the entire host app's Android build. Rewrote the early-out as idiomatic
`appContext.reactContext?.let { ... }` so the lambda's last expression is the
only return path. Also applied the same shape to `startAnrWatchdog` (which
took a parameter and so still compiled, but carried the identical latent
hazard) for consistency and future-proofing.
