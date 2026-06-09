// v2.7 — Push notification subsystem.
//
// Public API:
//   * `tokens::register_token` / `tokens::revoke_token` — device handle CRUD
//   * `send::enqueue_send`                              — queue a send + idempotency check
//   * `delivery::get_receipt`                           — receipt by send id
//   * `dispatch_cron::spawn_cron`                       — background dispatcher (mirrors webhook_dispatch)
//   * `providers::Provider`                             — trait every concrete provider implements
//   * `expo_compat`                                     — wire shape translation Sentori ↔ Expo
//
// Provider live status (v2.7):
//   APNs       — live
//   FCM        — live
//   Web Push   — stub (lights in v2.8)
//   HCM (华为) — stub (lights in v2.12)
//   MiPush     — stub (lights in v2.12)
//
// See docs/design/push-architecture.md for the cross-version
// design contract.

pub mod delivery;
pub mod dispatch_cron;
pub mod expo_compat;
pub mod providers;
pub mod quarantine;
pub mod rate_limit;
pub mod retry;
pub mod send;
pub mod send_gate;
pub mod token_cache;
pub mod tokens;
pub mod types;

pub use providers::{Provider, ProviderError, ProviderKind, SendOutcome};
pub use types::{NativeMessage, NativeOptions, Priority, SendStatus, Ticket};
