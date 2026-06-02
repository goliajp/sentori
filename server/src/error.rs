use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::Serialize;
use thiserror::Error;
use validator::ValidationErrors;

use crate::correlation_id;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("validation failed")]
    Validation(ValidationErrors),
    /// 400 with a human-readable message. Use for cross-field
    /// validation that `validator` can't express declaratively
    /// (e.g. `kind = message ⇒ message + level required`).
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal: {0}")]
    Internal(String),
    #[error("not found")]
    NotFound,
    #[error("database unavailable")]
    DatabaseUnavailable,
    #[error("forbidden")]
    Forbidden,
    /// 503 with a stable error code in the body. Used when a feature
    /// depends on optional config (`SENTORI_GITHUB_PAT`, source repo
    /// URL, …) and that config isn't set on this deployment — so the
    /// feature is unavailable, but the caller knows *why* and can
    /// surface a "configure GitHub integration" link instead of a
    /// generic 500.
    #[error("unconfigured: {0}")]
    Unconfigured(&'static str),
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDetail {
    pub field: String,
    pub message: String,
}

/// F2 — every non-2xx HTTP response carries this structured shape.
/// See `docs/design/architecture-standards.md` §5.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBodyV2 {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_url: Option<String>,
    pub correlation_id: String,
    pub layer: String,
    /// Validation details when applicable. Empty for non-validation
    /// errors so callers can rely on the top-level shape.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<ValidationDetail>,
}

#[derive(Serialize)]
struct ErrorEnvelope {
    error: ErrorBodyV2,
}

/// Build a structured error response. Caller picks status, code,
/// message, hint, layer; correlation id is pulled from the
/// task-local set by the F1 middleware.
pub fn err_response(
    status: StatusCode,
    code: &str,
    message: impl Into<String>,
    layer: &str,
) -> Response {
    err_response_with(status, code, message, None, None, layer, vec![])
}

/// Full builder when caller has a hint / doc_url / validation details
/// to attach. Use the doc URL `https://sentori.golia.jp/docs/errors/<code>`
/// pattern (auto-generated pages land in P5).
pub fn err_response_with(
    status: StatusCode,
    code: &str,
    message: impl Into<String>,
    hint: Option<String>,
    doc_url: Option<String>,
    layer: &str,
    details: Vec<ValidationDetail>,
) -> Response {
    let body = ErrorBodyV2 {
        code: code.to_string(),
        message: message.into(),
        hint,
        doc_url,
        correlation_id: correlation_id::current().to_string(),
        layer: layer.to_string(),
        details,
    };
    (status, Json(ErrorEnvelope { error: body })).into_response()
}

// Legacy shape — kept for compatibility within this module's
// `AppError::IntoResponse` until the migration finishes; new code
// should call `err_response[_with]` directly.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    details: Vec<ValidationDetail>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::Validation(errs) => {
                let details = flatten_validation_errors(&errs);
                err_response_with(
                    StatusCode::BAD_REQUEST,
                    "domain.validation",
                    "validation failed",
                    Some("see error.details for per-field messages".to_string()),
                    None,
                    "domain.validation",
                    details,
                )
            }
            AppError::BadRequest(msg) => err_response(
                StatusCode::BAD_REQUEST,
                "domain.badRequest",
                &msg,
                "domain.badRequest",
            ),
            AppError::Internal(msg) => {
                tracing::error!(error = %msg, "internal error");
                err_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal.unexpected",
                    "unexpected server error",
                    "internal",
                )
            }
            AppError::NotFound => err_response(
                StatusCode::NOT_FOUND,
                "domain.notFound",
                "no such entity",
                "domain",
            ),
            AppError::DatabaseUnavailable => err_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "internal.dbDown",
                "service degraded, retry in 30 s",
                "internal.db",
            ),
            AppError::Forbidden => err_response(
                StatusCode::FORBIDDEN,
                "auth.forbidden",
                "caller is authenticated but not allowed for this resource",
                "auth",
            ),
            AppError::Unconfigured(code) => return err_response(
                StatusCode::SERVICE_UNAVAILABLE,
                code,
                "feature requires server-side configuration",
                "internal.config",
            ),
            #[allow(unreachable_patterns)]
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorBody {
                    error: "internal",
                    details: vec![],
                }),
            )
                .into_response(),
        }
    }
}

pub fn flatten_validation_errors(errs: &ValidationErrors) -> Vec<ValidationDetail> {
    let mut out = Vec::new();
    flatten_inner(errs, "", &mut out);
    out
}

fn flatten_inner(errs: &ValidationErrors, prefix: &str, out: &mut Vec<ValidationDetail>) {
    for (field, kind) in errs.errors() {
        let path = if prefix.is_empty() {
            field.to_string()
        } else {
            format!("{prefix}.{field}")
        };

        match kind {
            validator::ValidationErrorsKind::Field(field_errs) => {
                for fe in field_errs {
                    let message = fe
                        .message
                        .clone()
                        .map(|m| m.to_string())
                        .unwrap_or_else(|| fe.code.to_string());
                    out.push(ValidationDetail {
                        field: path.clone(),
                        message,
                    });
                }
            }
            validator::ValidationErrorsKind::Struct(nested) => {
                flatten_inner(nested, &path, out);
            }
            validator::ValidationErrorsKind::List(items) => {
                for (i, nested) in items.iter() {
                    let item_path = format!("{path}[{i}]");
                    flatten_inner(nested, &item_path, out);
                }
            }
        }
    }
}
