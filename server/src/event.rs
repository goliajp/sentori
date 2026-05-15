use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: Uuid,

    #[serde(with = "time::serde::rfc3339")]
    pub timestamp: OffsetDateTime,

    pub kind: EventKind,
    pub platform: Platform,

    #[validate(length(min = 1, max = 200))]
    pub release: String,

    #[validate(length(min = 1, max = 64))]
    pub environment: String,

    #[validate(nested)]
    pub device: Device,

    #[validate(nested)]
    pub app: App,

    #[serde(default)]
    pub user: Option<User>,

    #[serde(default)]
    pub tags: BTreeMap<String, String>,

    /// v0.9.0 #13 — feature-flag state at capture. Distinct dimension
    /// from `tags`; the dashboard can facet on these as "experiment
    /// was active". Same string→string shape; length-capped at 200 to
    /// match the SDK side.
    #[serde(default)]
    pub flags: BTreeMap<String, String>,

    #[serde(default)]
    pub breadcrumbs: Vec<Breadcrumb>,

    #[validate(nested)]
    pub error: ErrorObject,

    #[serde(default)]
    pub fingerprint: Vec<String>,

    #[serde(default)]
    pub trace_id: Option<String>,

    #[serde(default)]
    pub span_id: Option<String>,

    /// Server-set at ingest. Lets the dashboard tell apart "no source
    /// map uploaded for this release" from "a map exists but these
    /// frames didn't resolve through it" (wrong build / frame outside
    /// range). Clients never send this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbolication: Option<SymbolicationInfo>,

    /// Phase 42 sub-C.05: references to blobs previously uploaded to
    /// `/v1/events/{id}/attachments/<kind>`. The `ref` field is the
    /// only one we trust — server looks it up in `event_attachments`
    /// to verify it was issued for this (event_id, project_id) tuple.
    /// Other fields are echoed back to the dashboard for display.
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,

    /// v0.8.0-d — server-set during ingest from a GeoIP lookup on the
    /// client's IP (parsed from `x-forwarded-for` or the peer addr).
    /// Clients never send this — the field is ignored on the wire if
    /// it arrives in the request body and overwritten before persist.
    /// `None` when the lookup db isn't configured or the IP isn't
    /// resolvable (private range, localhost during dev).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geo: Option<Geo>,

    /// v0.9.0 #10 — OTA bundle (Expo EAS / CodePush) currently loaded.
    /// Distinct from `release` (which is the store binary).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle: Option<Bundle>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geo {
    /// ISO 3166-1 alpha-2 country code, uppercase (`JP`, `US`, ...).
    pub country: String,
    /// ISO 3166-2 subdivision code without the country prefix (`13`
    /// for Tokyo when country is JP, `CA` for California when US),
    /// or `None` if the lookup db doesn't have subdivision data
    /// (DB-IP Lite IP-to-Country is country-only — region populates
    /// only when the operator switches to a city-grade db).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// City name, only present on a city-grade db.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub r#ref: Uuid,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolicationInfo {
    /// True if a `kind: sourcemap` artifact is uploaded for this
    /// event's `release`.
    pub release_has_map: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Error,
    /// Phase 22 sub-D: Android ANR (≥ 5 s main-thread freeze). The
    /// SDK posts an event-shaped payload with `kind = "anr"` and a
    /// captured main-thread stack. iOS hangs (sub-E) will share this
    /// kind once the dedicated detector lands.
    Anr,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Platform {
    Javascript,
    Ios,
    Android,
}

impl Platform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::Javascript => "javascript",
            Platform::Ios => "ios",
            Platform::Android => "android",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub os: DeviceOs,

    #[validate(length(min = 1, max = 64))]
    pub os_version: String,

    #[serde(default)]
    #[validate(length(max = 128))]
    pub model: Option<String>,

    #[serde(default)]
    #[validate(length(max = 32))]
    pub locale: Option<String>,

    /// v0.8.0-c — effective network class at capture time. JS SDKs
    /// fill this from `navigator.connection.effectiveType`; RN SDK
    /// caches the latest `@react-native-community/netinfo` state.
    /// Free-form short string (`wifi`, `4g`, `offline`, ...). Server
    /// trusts the client value; dashboard reads it as a tag.
    #[serde(default)]
    #[validate(length(max = 16))]
    pub network_type: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceOs {
    Ios,
    Android,
    Web,
    Other,
}

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct App {
    #[validate(length(min = 1, max = 64))]
    pub version: String,

    #[serde(default)]
    #[validate(length(max = 64))]
    pub build: Option<String>,

    #[serde(default)]
    #[validate(nested)]
    pub framework: Option<Framework>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct Framework {
    #[validate(length(min = 1, max = 64))]
    pub name: String,

    #[validate(length(min = 1, max = 64))]
    pub version: String,
}

/// PII-minimal user identity attached to an event. The shape is
/// intentionally limited to `{ id, anonymous }` — no email, name, IP,
/// or other identifying fields. Phase 16 sub-D's privacy stance: the
/// server never indexes user data and the SDK can't ship richer
/// identities without changing this struct first.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct User {
    #[serde(default)]
    pub id: Option<String>,

    #[serde(default)]
    pub anonymous: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ErrorObject {
    #[serde(rename = "type")]
    #[validate(length(min = 1, max = 256))]
    pub r#type: String,

    #[validate(length(max = 4096))]
    pub message: String,

    #[validate(length(min = 1, max = 100), nested)]
    pub stack: Vec<Frame>,

    #[serde(default)]
    pub cause: Option<Box<ErrorObject>>,

    /// Phase 44 sub-E — cross-stack cause chain. When the SDK
    /// recognises that this error was triggered by an earlier
    /// native crash (or the native crash bridge bubbled up into JS),
    /// the SDK stamps a pointer into the related issue here. The
    /// dashboard renders it as the deepest "caused by" card with a
    /// link to the native issue's own detail page.
    ///
    /// Server side is **purely pass-through**: we don't validate
    /// the issueId resolves to an existing native issue (it might
    /// have been deleted / not arrived yet); the dashboard handles
    /// the broken-link case. Fields are kept tight (no full stack)
    /// so events don't double in size when SDK starts populating it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_error: Option<NativeErrorRef>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct NativeErrorRef {
    /// Issue id of the native crash — `issues.id` UUID. Dashboard
    /// builds the back-link from this.
    pub issue_id: uuid::Uuid,
    /// Echoed for dashboard rendering without a second round-trip.
    #[validate(length(max = 256))]
    pub r#type: String,
    #[validate(length(max = 4096))]
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    #[serde(default)]
    pub function: Option<String>,

    #[validate(length(min = 1, max = 512))]
    pub file: String,

    pub line: u32,

    #[serde(default)]
    pub column: Option<u32>,

    pub in_app: bool,

    #[serde(default)]
    pub absolute_path: Option<String>,

    #[serde(default)]
    pub pre_context: Vec<String>,

    #[serde(default)]
    pub post_context: Vec<String>,

    /// The source line at `line` itself, between `pre_context` and
    /// `post_context`. Server-set on JS frames symbolicated at ingest
    /// (so the dashboard can render the snippet inline without a
    /// per-frame fetch); native SDKs may also fill it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_line: Option<String>,

    /// Pre-symbolication coordinates. Set by the server when it rewrites
    /// `file`/`line`/`column` via an uploaded source map at ingest, so
    /// the dashboard's "show source" lookup (which reverse-maps through
    /// the same map) still has the bundle position to start from.
    /// Clients never send these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_line: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_column: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breadcrumb {
    #[serde(with = "time::serde::rfc3339")]
    pub timestamp: OffsetDateTime,

    #[serde(rename = "type")]
    pub r#type: BreadcrumbType,

    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BreadcrumbType {
    Nav,
    Net,
    Log,
    User,
    Custom,
}
