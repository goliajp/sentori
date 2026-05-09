use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::Serialize;
use thiserror::Error;
use validator::ValidationErrors;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("validation failed")]
    Validation(ValidationErrors),
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDetail {
    pub field: String,
    pub message: String,
}

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
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorBody {
                        error: "validationFailed",
                        details,
                    }),
                )
                    .into_response()
            }
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
