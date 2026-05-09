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
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Error,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
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
