use sha2::{Digest, Sha256};

use crate::event::{Event, EventKind, Frame};

/// Compute a 16-byte (32 hex char) fingerprint for an event.
///
/// Priority:
/// 1. If the client supplied a non-empty `event.fingerprint[0]`, use
///    it verbatim — clients can override the default grouping.
/// 2. For `kind = message` (v2.0): `sha256(release || normalize(message))`
///    — manual reports group by release + normalised body.
/// 3. Otherwise (error / anr / nearCrash):
///    `sha256(release || error.type || normalize(error.message)
///           || first_in_app_frame.function || first_in_app_frame.file)`
///    falling back to the top stack frame if no in-app frame exists.
///
/// Why all three inputs (message + release) are in the fingerprint
/// — Sentori's deliberate divergence from Sentry / Bugsnag defaults:
///
///   - **Different messages split.** `"pinning mismatch (mode=block)"`
///     and `"pinning mismatch (mode=alert-only)"` on the same
///     callsite are functionally different conditions — block vs
///     alert-only is a behaviour split, not the same bug. v1.x
///     collapsed both into one issue and made triage impossible
///     without scrolling individual events.
///
///   - **Different releases split.** A bug observed in `5.3` and a
///     bug observed in `5.4` are tracked separately so each release's
///     issue list reads cleanly without per-version context. The
///     Sentry default groups them and uses a `resolved → regressed`
///     status flip on the same row to flag re-occurrence; product
///     decision (2026-05-22, post-user feedback) is the opposite —
///     **per-release isolation beats cross-release regression flip**.
///     If "did a fixed bug come back" is the question, the dashboard
///     can answer via a related-issues panel on the issue page rather
///     than a status flip on a shared row.
///
///   - `normalize_message` strips digit runs (≥ 4) so dynamic IDs /
///     timestamps / counts don't fragment grouping below the
///     "same condition" level: `User 12345 timed out` and
///     `User 67890 timed out` still group together (same condition,
///     just different identifiers).
pub fn fingerprint(event: &Event) -> String {
    if let Some(client_fp) = event.fingerprint.first() {
        if !client_fp.is_empty() {
            return client_fp.clone();
        }
    }

    let mut hasher = Sha256::new();

    if event.kind == EventKind::Message {
        // Group manual messages by release + normalised body.
        hasher.update(event.release.as_bytes());
        hasher.update(b"|");
        if let Some(msg) = &event.message {
            hasher.update(normalize_message(msg).as_bytes());
        }
    } else if let Some(err) = &event.error {
        // Include release + normalised error message + callsite.
        // `(mode=block)` vs `(mode=alert-only)` on the same callsite
        // split via message; `5.3` vs `5.4` of the same exception
        // split via release. Original v1.x grouped on `type + frame`
        // alone, which was too aggressive on both axes.
        hasher.update(event.release.as_bytes());
        hasher.update(b"|");
        hasher.update(err.r#type.as_bytes());
        hasher.update(b"|");
        hasher.update(normalize_message(&err.message).as_bytes());
        hasher.update(b"|");
        let frame = first_in_app_frame(&err.stack).or_else(|| err.stack.first());
        if let Some(f) = frame {
            if let Some(fn_name) = &f.function {
                hasher.update(fn_name.as_bytes());
            }
            hasher.update(b"|");
            hasher.update(f.file.as_bytes());
        }
    } else {
        // No error, no message — degenerate event. Hash on release +
        // kind + timestamp so each lands in its own group rather than
        // collapsing every degenerate event into one.
        hasher.update(event.release.as_bytes());
        hasher.update(format!("{:?}", event.kind).as_bytes());
        hasher.update(event.timestamp.unix_timestamp().to_be_bytes());
    }

    let digest = hasher.finalize();
    hex::encode(&digest[..16])
}

/// Strip ISO timestamps, UUIDs, and digit runs of length ≥ 4 from a
/// message string so "User 12345 timed out" and "User 67890 timed
/// out" group together. Same shape v0.6 sub-D applied to error
/// messages.
fn normalize_message(msg: &str) -> String {
    // Replace UUIDs (8-4-4-4-12 hex).
    let mut out = String::with_capacity(msg.len());
    let mut chars = msg.chars().peekable();
    while chars.peek().is_some() {
        // Try to consume a digit run.
        let mut digits = String::new();
        while let Some(&c) = chars.peek() {
            if c.is_ascii_digit() {
                digits.push(c);
                chars.next();
            } else {
                break;
            }
        }
        if digits.len() >= 4 {
            out.push_str("<N>");
        } else {
            out.push_str(&digits);
        }
        if let Some(&c) = chars.peek() {
            out.push(c);
            chars.next();
        }
    }
    out
}

fn first_in_app_frame(stack: &[Frame]) -> Option<&Frame> {
    stack.iter().find(|f| f.in_app)
}
