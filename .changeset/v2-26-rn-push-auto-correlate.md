---
'@goliapkg/sentori-core': minor
'@goliapkg/sentori-react-native': minor
---

v2.26 — RN SDK auto-correlation pipeline.

- New `BreadcrumbType` `'push'` for the auto-emitted breadcrumb when the SDK
  receives a push carrying `_sentori.msgId` (server injects in v2.25+).
  Same union shape on the server (`server/src/event.rs` `BreadcrumbType::Push`).
- RN drain loop, on a notification with `_sentori.msgId`:
    - writes a `{ type: 'push', data: { msgId, title, body, opened, provider } }`
      breadcrumb so a later `captureException` shows the push that just arrived.
    - emits `sentori.push.received` (or `sentori.push.opened` for taps) through
      the existing track pipeline.
    - enqueues an ack POST to `/v1/push/sends/<msgId>/ack` — flushed every 5s
      in the background. Server-side `push_sends.acked_at` flips on first ack.
- `sentori.push.setSessionContext(sessionId)` stamps the host's current
  session id on outgoing acks for v2.27 push×session BI correlation.
- Zero host-app code change required to opt in. Payloads without
  `_sentori.msgId` (older server, non-Sentori sender) flow through
  unchanged — no breadcrumb, no track, no ack.
