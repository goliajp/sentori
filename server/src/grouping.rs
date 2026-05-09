use sha2::{Digest, Sha256};

use crate::event::{Event, Frame};

/// Compute a 16-byte (32 hex char) fingerprint for an error event.
///
/// Priority:
/// 1. If the client supplied a non-empty `event.fingerprint[0]`, use it
///    verbatim — clients can override the default grouping.
/// 2. Otherwise:
///    `sha256(error.type + first_in_app_frame.function + first_in_app_frame.file)[0..16]`
///    falling back to the top stack frame if no in-app frame exists.
pub fn fingerprint(event: &Event) -> String {
    if let Some(client_fp) = event.fingerprint.first() {
        if !client_fp.is_empty() {
            return client_fp.clone();
        }
    }

    let mut hasher = Sha256::new();
    hasher.update(event.error.r#type.as_bytes());

    let frame = first_in_app_frame(&event.error.stack)
        .or_else(|| event.error.stack.first());
    if let Some(f) = frame {
        if let Some(fn_name) = &f.function {
            hasher.update(fn_name.as_bytes());
        }
        hasher.update(f.file.as_bytes());
    }

    let digest = hasher.finalize();
    hex::encode(&digest[..16])
}

fn first_in_app_frame(stack: &[Frame]) -> Option<&Frame> {
    stack.iter().find(|f| f.in_app)
}
