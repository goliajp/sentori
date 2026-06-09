// v2.7 — Expo wire-shape compatibility layer.
//
// `POST /v1/push/expo-compat/send` accepts Expo's exact request
// shape and returns Expo's exact response shape, so customers using
// `expo-server-sdk` can swap the base URL without code changes.
//
// Expo shape (per https://docs.expo.dev/push-notifications/sending-notifications/):
//   request:
//     ExpoMessage | ExpoMessage[]
//     where ExpoMessage = {
//       to: string | string[],
//       title?: string,
//       body?: string,
//       data?: object,
//       sound?: "default" | null,
//       badge?: number,
//       priority?: "default" | "normal" | "high",
//       ttl?: number,
//       expiration?: number,    // seconds; ignored, we use ttl
//       channelId?: string,
//       categoryId?: string,
//       mutableContent?: boolean,
//       _displayInForeground?: boolean,    // legacy; ignored
//     }
//   response:
//     { data: ExpoTicket | ExpoTicket[], errors?: ExpoSendError[] }
//     where ExpoTicket =
//       { status: "ok", id: string }
//       | { status: "error", message: string, details?: { error: string } }
//
// This module owns the bidirectional translation. The routes layer
// calls `to_native(...)` on input and `to_expo_response(...)` on
// output.

use serde::{Deserialize, Serialize};

use crate::push::types::{NativeMessage, NativeOptions, Priority, SendStatus, Ticket, ToField};

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ExpoRequest {
    Single(ExpoMessage),
    Batch(Vec<ExpoMessage>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpoMessage {
    pub to: ToField,
    pub title: Option<String>,
    pub body: Option<String>,
    pub data: Option<serde_json::Value>,
    pub sound: Option<String>,
    pub badge: Option<i32>,
    pub priority: Option<String>,
    pub ttl: Option<i32>,
    pub channel_id: Option<String>,
    pub category_id: Option<String>,
    pub mutable_content: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ExpoTicket {
    #[serde(rename = "ok")]
    Ok { id: String },
    #[serde(rename = "error")]
    Error {
        id: Option<String>,
        message: String,
        details: Option<ExpoTicketErrorDetails>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpoTicketErrorDetails {
    pub error: String,
}

/// Body shape for `POST /v1/push/expo-compat/send` response.
#[derive(Debug, Clone, Serialize)]
pub struct ExpoResponseEnvelope {
    pub data: Vec<ExpoTicket>,
}

/// Translate one Expo message into the Sentori-native shape the
/// dispatcher consumes.
pub fn to_native(msg: ExpoMessage) -> NativeMessage {
    let priority = match msg.priority.as_deref() {
        Some("high") => Some(Priority::High),
        Some("normal") | Some("default") => Some(Priority::Normal),
        _ => None,
    };
    NativeMessage {
        to: msg.to,
        title: msg.title,
        body: msg.body,
        data: msg.data,
        options: NativeOptions {
            sound: msg.sound,
            badge: msg.badge,
            priority,
            ttl: msg.ttl,
            mutable_content: msg.mutable_content,
            content_available: None,
            collapse_key: None,
            channel_id: msg.channel_id,
            category: msg.category_id,
            rich_media: None,
            actions: None,
        },
        idempotency_key: None,
            campaign_id: None,
            template_id: None,
            audience_tag: None,
    }
}

/// Translate one Sentori Ticket into the Expo response shape.
pub fn to_expo_ticket(t: Ticket) -> ExpoTicket {
    match t.status {
        SendStatus::Failed => ExpoTicket::Error {
            id: Some(t.id),
            message: t.error.clone().unwrap_or_else(|| "send failed".into()),
            details: t.error.map(|e| ExpoTicketErrorDetails { error: e }),
        },
        // `queued` and `sent` both surface to Expo as ok — the
        // customer can fetch the receipt to learn the eventual fate.
        SendStatus::Queued | SendStatus::Sent => ExpoTicket::Ok { id: t.id },
    }
}
