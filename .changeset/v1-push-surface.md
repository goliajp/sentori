---
'@goliapkg/sentori-react-native': major
'@goliapkg/sentori-core': major
---

The push API is one shape now, and the SDK calls it.

`/v1/push/tokens` is `/v1/push/devices` — four things in this system
are called a token and the thing being registered is a device. The
register response is `{ spToken, isNew }`; `token_id` and `is_new` are
gone. The ack posts to `/v1/push/deliveries/{deliveryId}/ack`, because
the id it carries is one device's row and not the call that produced
it.

Every field on `/v1`, in both directions, is camelCase.
