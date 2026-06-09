---
'@goliapkg/sentori-core': minor
'@goliapkg/sentori-expo': minor
---

v2.28 — Push rich-media (image) support.

- New wire field `richMedia.imageUrl` on `/v1/push/send`. When set:
    - **Android (FCM):** server writes `message.notification.image`,
      FCM auto-renders the Android BigPicture style. Zero device-side
      work required.
    - **iOS (APNs):** server forces `aps.mutable-content: 1` and
      surfaces the URL under the reserved `sentori_attachment_url`
      key for a Notification Service Extension to download + attach.
    - **Web Push:** passes through under `data.sentori_attachment_url`
      for the host's Service Worker to use as `options.image`.
- The Sentori Expo plugin now writes a minimal NSE Swift template +
  `Info.plist` to `ios/SentoriNSE/` on every `expo prebuild`. The
  one-time Xcode target wiring is documented in the recipe; the
  template downloads the URL with a 5 s timeout + attaches.
- Opt out per-platform / per-template with `{ ios: false }` /
  `{ nse: false }` in `app.json` plugin props.
- Legacy customers (no `richMedia` field) see identical v2.27
  behaviour. Hosts without the NSE target installed still receive
  the text-only notification — `mutable-content:1` is harmless when
  no extension is registered.
