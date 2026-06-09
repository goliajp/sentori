// v2.7 — wire + internal types for the push subsystem.
//
// `NativeMessage` is the Sentori-native payload shape that flows
// through `/v1/push/send` (the preferred wire format). `Ticket` is
// what the API returns. The Expo-compat endpoint translates between
// these and Expo's own shapes in `expo_compat`.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Send shape on `POST /v1/push/send`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMessage {
    /// `ipt_<uuid>` handle, or an array of them. Server side splits
    /// array fan-out into N rows in `push_sends`.
    pub to: ToField,
    pub title: Option<String>,
    pub body: Option<String>,
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub options: NativeOptions,
    pub idempotency_key: Option<String>,
    /// v2.25 — optional free-text tag identifying the campaign this
    /// send belongs to. Write-only in v2.25; surfaces in v2.27 push-
    /// correlation BI ("what did campaign X cause?"). Caller defines
    /// the taxonomy.
    #[serde(default)]
    pub campaign_id: Option<String>,
    /// v2.25 — optional template id (which content variant fired).
    #[serde(default)]
    pub template_id: Option<String>,
    /// v2.25 — optional audience tag (segment / cohort label).
    #[serde(default)]
    pub audience_tag: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ToField {
    Single(String),
    Many(Vec<String>),
    /// v2.31 — topic fanout. `to: { topic: "<name>" }` resolves to
    /// every `device_tokens` row in the calling project whose
    /// `device_topics.topic = <name>` AND `revoked_at IS NULL`.
    Topic(TopicTarget),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicTarget {
    pub topic: String,
}

impl ToField {
    pub fn as_vec(&self) -> Vec<String> {
        match self {
            ToField::Single(s) => vec![s.clone()],
            ToField::Many(v) => v.clone(),
            // Topic gets resolved at enqueue time; the wire-level
            // shape returns an empty handle list so legacy code
            // paths don't accidentally treat the topic name as a
            // device handle.
            ToField::Topic(_) => Vec::new(),
        }
    }
    /// v2.31 — `Some(topic)` when the send is a topic fanout.
    pub fn as_topic(&self) -> Option<&str> {
        match self {
            ToField::Topic(t) => Some(t.topic.as_str()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOptions {
    /// "default" / null. Mirrors APNs `aps.sound` + FCM
    /// `notification.sound`.
    pub sound: Option<String>,
    /// iOS badge count. Most other providers ignore.
    pub badge: Option<i32>,
    pub priority: Option<Priority>,
    /// Seconds. APNs `apns-expiration`, FCM `ttl`.
    pub ttl: Option<i32>,
    /// iOS mutable-content (notification service extension hook).
    pub mutable_content: Option<bool>,
    /// iOS content-available (silent / background push).
    pub content_available: Option<bool>,
    /// FCM collapse_key / APNs apns-collapse-id.
    pub collapse_key: Option<String>,
    /// Android notification channel id.
    pub channel_id: Option<String>,
    /// iOS category id (action button group).
    pub category: Option<String>,
    /// v2.28 — rich-media attachments. Image only in v2.28; future
    /// versions may add video/audio. When `imageUrl` is set:
    ///   - APNs: forces `aps.mutable-content: 1` and emits a top-
    ///     level `sentori_attachment_url` custom-data key the NSE
    ///     reads to download + attach.
    ///   - FCM: sets `message.notification.image` so Android auto-
    ///     renders BigPicture style.
    ///   - WebPush: passes through under `data.sentori_attachment_url`
    ///     for the Service Worker to use as `options.image`.
    pub rich_media: Option<RichMedia>,
    /// v2.29 — interactive action buttons. Server passes the list
    /// through to the device under custom data `sentori_actions`.
    /// Host app reads on tap to dispatch. iOS category registration
    /// remains a host-app concern (Apple requires registration at
    /// launch).
    #[serde(default)]
    pub actions: Option<Vec<PushAction>>,
    /// v2.30 — iOS 15+ interruption-level. One of `passive` /
    /// `active` / `timeSensitive` / `critical`. Maps to APNs
    /// `aps.interruption-level`. iOS only; other providers ignore.
    #[serde(default)]
    pub interruption_level: Option<String>,
    /// v2.30 — iOS notification grouping. Maps to APNs
    /// `aps.thread-id`. iOS uses this to fold same-thread
    /// notifications into one summary on lock-screen.
    #[serde(default)]
    pub thread_identifier: Option<String>,
    /// v2.30 — Android notification priority. One of `high` /
    /// `default` / `low` / `min`. Maps to FCM
    /// `message.android.notification.notification_priority`.
    /// iOS / others ignore. Distinct from the cross-platform
    /// `priority: Priority { Normal, High }` which addresses both
    /// APNs `apns-priority` header and FCM message priority.
    #[serde(default)]
    pub channel_importance: Option<String>,
}

/// v2.28 — rich-media attachment payload. Image only in this version.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RichMedia {
    /// HTTPS URL of the image to attach. iOS NSE downloads + attaches;
    /// FCM uses for BigPicture; WebPush passes through.
    pub image_url: Option<String>,
}

/// v2.29 — one interactive action button. Renders next to the
/// notification on platforms that support it. Server passes the
/// full list under `sentori_actions` custom data; the host app
/// reads + dispatches.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushAction {
    /// Stable id — the host receives this in the tap callback to
    /// dispatch (`actionId`).
    pub id: String,
    /// Visible button title.
    pub title: String,
    /// iOS-only: action opens a text input field.
    #[serde(default)]
    pub is_text_input: Option<bool>,
    /// iOS-only: tints the action button red.
    #[serde(default)]
    pub is_destructive: Option<bool>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Normal,
    High,
}

/// Wire-format response shape — `/v1/push/send` returns
/// `{ ticket: ... }` for a single message or `{ tickets: [...] }`
/// for a batch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: String,
    pub status: SendStatus,
    pub provider_outcome: Option<String>,
    pub error: Option<String>,
    pub retry_count: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub sent_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SendStatus {
    Queued,
    Sent,
    Failed,
}

impl SendStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SendStatus::Queued => "queued",
            SendStatus::Sent => "sent",
            SendStatus::Failed => "failed",
        }
    }

    pub fn from_db(s: &str) -> Self {
        match s {
            "sent" => SendStatus::Sent,
            "failed" => SendStatus::Failed,
            _ => SendStatus::Queued,
        }
    }
}

/// Wire token format. `ipt_` prefix matches the insight-push-server
/// prior art so Expo-compat consumers see a stable shape.
pub fn format_token_handle(uuid: Uuid) -> String {
    format!("ipt_{}", uuid.as_simple())
}

/// Wire send-id format. `send_<uuid_no_dashes>`.
pub fn format_send_id(uuid: Uuid) -> String {
    format!("send_{}", uuid.as_simple())
}

/// Parse `ipt_<uuid>` back to a UUID. Tolerant of any 32-hex variant.
pub fn parse_token_handle(s: &str) -> Option<Uuid> {
    let rest = s.strip_prefix("ipt_")?;
    Uuid::try_parse(rest).ok()
}

pub fn parse_send_id(s: &str) -> Option<Uuid> {
    let rest = s.strip_prefix("send_")?;
    Uuid::try_parse(rest).ok()
}
