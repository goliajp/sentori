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
}

impl ToField {
    pub fn as_vec(&self) -> Vec<String> {
        match self {
            ToField::Single(s) => vec![s.clone()],
            ToField::Many(v) => v.clone(),
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
