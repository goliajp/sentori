---
'@goliapkg/sentori-react-native': minor
'@goliapkg/sentori-core': minor
---

`user()` takes traits, and a registered device follows the person.

Registering for push and signing in happen in that order in every app
with a login screen, and nothing updated the device row in between —
so the row held no user for the life of the install, and a send aimed
at that person matched no device and reported success. The device now
re-registers by itself when the identity changes, only when it
actually changed, and only for a device that had registered.

`user({ id, traits })` carries attributes a push campaign can select
on. They travel raw beside the hashed identity, so the identity stays
unreadable and the selection stays possible; a call describes the
person completely, so signing out clears them.
