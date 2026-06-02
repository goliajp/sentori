// v0.9.2 +S6 — Privacy Lab.
//
// Background cron: every 15 min scan recently-ingested events for
// PII-shaped strings (email, phone, cc-like, address-like). New
// findings land in `pii_findings`; the dashboard's Privacy module
// reads from it to compute per-release Privacy Scores and surface
// the top leak fields.
//
// Performance:
//   • we paginate by `pii_scan_cursor` so an event never gets
//     scanned twice
//   • per-tick cap of 500 events keeps a long backlog from monopolising
//     the cron loop
//   • patterns are precompiled `once_cell::Lazy<Regex>`

use std::time::Duration;

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

const TICK_SECS: u64 = 15 * 60;
const PER_TICK_CAP: i64 = 500;
const SAMPLE_MAX_BYTES: usize = 64;

static RX_EMAIL: Lazy<Regex> = Lazy::new(|| {
    // Conservative — must look like name@host.tld with realistic chars.
    Regex::new(r"(?i)\b[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}\b").unwrap()
});
static RX_PHONE: Lazy<Regex> = Lazy::new(|| {
    // v0.9.8 — tightened from the earlier loose pattern. Insight's
    // 2026-05-16 report had every release flagged 0/100 because
    //   `5.4.26051603+349`        (app build id)
    //   `2026-05-16`               (ISO date substring)
    //   `10-227-60-214`            (IP-encoded subdomain)
    // all matched a 7+digit phone-ish run. Now the regex requires a
    // recognisable phone shape: leading `+CC` or a paren group, and
    // word-boundary anchored so it doesn't chew through build ids
    // embedded in larger strings. The `check_string` post-filter
    // also bumps the digit-count floor to 10 and skips known-safe
    // field paths.
    Regex::new(
        r"\b(?:\+[0-9]{1,3}[ \-]?(?:\(?[0-9]{2,4}\)?[ \-]?){2,4}[0-9]{2,4}|\([0-9]{3}\)[ \-]?[0-9]{3}[ \-]?[0-9]{4}|[0-9]{3}-[0-9]{3}-[0-9]{4})\b",
    )
    .unwrap()
});
static RX_CC: Lazy<Regex> = Lazy::new(|| {
    // 13-19 contiguous digits, optionally split by spaces or dashes
    // in groups of 4. Doesn't run Luhn — false-positives accepted.
    Regex::new(r"\b(?:[0-9]{4}[ \-]?){3,4}[0-9]{1,4}\b").unwrap()
});
static RX_ADDRESS: Lazy<Regex> = Lazy::new(|| {
    // Naive street-address sniff. Catches "123 Main St" / "45 Park Ave".
    Regex::new(r"\b[0-9]{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:St|Ave|Rd|Blvd|Ln|Dr|Way|Court|Ct|Pl)\b").unwrap()
});

pub fn spawn(pool: PgPool) {
    tokio::spawn(async move {
        // initial 60s warmup so we don't fight ingest at cold start
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            if let Err(e) = scan_once(&pool).await {
                tracing::warn!(error = %e, "privacy lab scan failed");
            }
            tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
        }
    });
}

/// v0.9.11 — admin-triggered re-scan for one project (optionally
/// one release). Used by the privacy rescan endpoint after a
/// classifier change so the score recovers without waiting for old
/// events to age out of the 7-day score window.
///
/// Steps:
///   1. DELETE findings for (project, release? )
///   2. DELETE cursor rows for events under (project, release?)
///   3. Re-run scan_payload on each affected event payload directly,
///      bounded by `per_call_cap` to keep request latency sane.
///
/// Returns (deleted_findings, deleted_cursors, rescanned_events,
/// new_findings) so the admin endpoint can tell the operator what
/// happened.
pub async fn rescan_release(
    pool: &PgPool,
    project_id: Uuid,
    release: Option<&str>,
    per_call_cap: i64,
) -> Result<(u64, u64, u64, u64)> {
    let deleted_findings = match release {
        Some(r) => sqlx::query(
            "DELETE FROM pii_findings WHERE project_id = $1 AND release = $2",
        )
        .bind(project_id)
        .bind(r)
        .execute(pool)
        .await?
        .rows_affected(),
        None => sqlx::query("DELETE FROM pii_findings WHERE project_id = $1")
            .bind(project_id)
            .execute(pool)
            .await?
            .rows_affected(),
    };

    let deleted_cursors = match release {
        Some(r) => sqlx::query(
            "DELETE FROM pii_scan_cursor WHERE event_id IN \
             (SELECT id FROM events WHERE project_id = $1 AND release = $2)",
        )
        .bind(project_id)
        .bind(r)
        .execute(pool)
        .await?
        .rows_affected(),
        None => sqlx::query(
            "DELETE FROM pii_scan_cursor WHERE event_id IN \
             (SELECT id FROM events WHERE project_id = $1)",
        )
        .bind(project_id)
        .execute(pool)
        .await?
        .rows_affected(),
    };

    // Pull events to re-scan. Same 7-day score window as the public
    // score formula so we don't waste time scanning rows that won't
    // affect the displayed number.
    let rows: Vec<(Uuid, String, Value)> = match release {
        Some(r) => sqlx::query_as(
            "SELECT id, release, payload FROM events \
             WHERE project_id = $1 AND release = $2 \
             AND received_at >= now() - interval '7 days' \
             ORDER BY received_at DESC LIMIT $3",
        )
        .bind(project_id)
        .bind(r)
        .bind(per_call_cap)
        .fetch_all(pool)
        .await?,
        None => sqlx::query_as(
            "SELECT id, release, payload FROM events \
             WHERE project_id = $1 \
             AND received_at >= now() - interval '7 days' \
             ORDER BY received_at DESC LIMIT $2",
        )
        .bind(project_id)
        .bind(per_call_cap)
        .fetch_all(pool)
        .await?,
    };
    let rescanned_events = rows.len() as u64;
    let mut new_findings: u64 = 0;

    for (event_id, evt_release, payload) in rows {
        let findings = scan_payload(&payload);
        for f in &findings {
            sqlx::query(
                "INSERT INTO pii_findings \
                 (id, project_id, release, event_id, field_path, pattern_kind, sample) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(Uuid::now_v7())
            .bind(project_id)
            .bind(&evt_release)
            .bind(event_id)
            .bind(&f.field_path)
            .bind(&f.kind)
            .bind(&f.sample)
            .execute(pool)
            .await?;
            new_findings += 1;
        }
        sqlx::query("INSERT INTO pii_scan_cursor (event_id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(event_id)
            .execute(pool)
            .await?;
    }
    Ok((deleted_findings, deleted_cursors, rescanned_events, new_findings))
}

async fn scan_once(pool: &PgPool) -> Result<()> {
    // Pull unscanned recent events. JOIN the cursor table to skip
    // already-processed ids.
    let rows: Vec<(Uuid, Uuid, String, Value)> = sqlx::query_as(
        r#"
        SELECT e.id, e.project_id, e.release, e.payload
        FROM events e
        LEFT JOIN pii_scan_cursor c ON c.event_id = e.id
        WHERE c.event_id IS NULL
          AND e.received_at >= now() - interval '24 hours'
        ORDER BY e.received_at ASC
        LIMIT $1
        "#,
    )
    .bind(PER_TICK_CAP)
    .fetch_all(pool)
    .await?;

    for (event_id, project_id, release, payload) in rows {
        let findings = scan_payload(&payload);
        for f in &findings {
            sqlx::query(
                "INSERT INTO pii_findings \
                 (id, project_id, release, event_id, field_path, pattern_kind, sample) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(Uuid::now_v7())
            .bind(project_id)
            .bind(&release)
            .bind(event_id)
            .bind(&f.field_path)
            .bind(&f.kind)
            .bind(&f.sample)
            .execute(pool)
            .await?;
        }
        sqlx::query("INSERT INTO pii_scan_cursor (event_id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(event_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct Finding {
    field_path: String,
    kind: String,
    sample: String,
}

/// Walk the event JSON; for every string value, run PII regex passes.
/// Returns one finding per match (capped at 50 per event to bound
/// pathological inputs).
fn scan_payload(payload: &Value) -> Vec<Finding> {
    let mut out: Vec<Finding> = Vec::new();
    fn walk(v: &Value, path: &str, out: &mut Vec<Finding>) {
        if out.len() >= 50 {
            return;
        }
        match v {
            Value::String(s) => check_string(s, path, out),
            Value::Object(o) => {
                for (k, sub) in o {
                    let next = if path.is_empty() {
                        k.clone()
                    } else {
                        format!("{path}.{k}")
                    };
                    walk(sub, &next, out);
                }
            }
            Value::Array(arr) => {
                for (i, sub) in arr.iter().enumerate() {
                    let next = format!("{path}[{i}]");
                    walk(sub, &next, out);
                }
            }
            _ => {}
        }
    }
    walk(payload, "", &mut out);
    out
}

fn check_string(s: &str, path: &str, out: &mut Vec<Finding>) {
    // Skip paths the operator likely wants to keep raw (e.g. error
    // messages with module names + line numbers shouldn't fire on
    // phone regex).
    if path.ends_with(".stack") || path.contains(".error.type") {
        return;
    }
    // v0.9.8 — Insight 2026-05-16: structural fields that store
    // version-strings / urls / build identifiers were getting
    // mis-flagged because their values contain long digit runs that
    // *look* phone-shaped. These paths are never user input; skip
    // PII scanning on them entirely.
    if is_structural_path(path) {
        return;
    }
    if let Some(m) = RX_EMAIL.find(s) {
        out.push(Finding {
            field_path: path.to_string(),
            kind: "email".into(),
            sample: truncate_sample(m.as_str()),
        });
    } else if let Some(m) = RX_CC.find(s) {
        // CC before phone — both can match digit-heavy strings; the
        // CC pattern requires the 4-group structure so it's more
        // specific.
        out.push(Finding {
            field_path: path.to_string(),
            kind: "cc-like".into(),
            sample: truncate_sample(m.as_str()),
        });
    } else if let Some(m) = RX_PHONE.find(s) {
        let candidate = m.as_str();
        // Post-filter: the new regex anchors on shape but we still
        // sanity-check the digit count, and skip when the surrounding
        // string is obviously a UUID, timestamp, or build identifier.
        let digit_count = candidate.chars().filter(|c| c.is_ascii_digit()).count();
        if digit_count >= 10 && digit_count <= 15 && !looks_like_non_phone(s) {
            out.push(Finding {
                field_path: path.to_string(),
                kind: "phone".into(),
                sample: truncate_sample(candidate),
            });
        }
    }
    if let Some(m) = RX_ADDRESS.find(s) {
        out.push(Finding {
            field_path: path.to_string(),
            kind: "address-like".into(),
            sample: truncate_sample(m.as_str()),
        });
    }
}

/// v0.9.8 — paths that hold technical identifiers, never user input.
/// Anchoring on these saves the false-positive cost of value-level
/// regex hacks.
fn is_structural_path(path: &str) -> bool {
    // .release, .app.version, .app.build — version identifiers
    if path.ends_with(".release")
        || path.ends_with(".version")
        || path.ends_with(".build")
        || path == "release"
    {
        return true;
    }
    // .url / .uri / hostname-style breadcrumb fields. Hostnames with
    // dashed IP-encoded subdomains and CDN hostnames have long digit
    // runs that look phone-shaped.
    if path.ends_with(".url") || path.ends_with(".uri") || path.ends_with(".host") {
        return true;
    }
    // .id paths (UUIDs, event ids, span ids, trace ids).
    if path.ends_with(".id") || path == "id" {
        return true;
    }
    // Bundle / sourcemap identifiers.
    if path.ends_with(".bundleId") || path.ends_with(".commit") {
        return true;
    }
    false
}

fn truncate_sample(s: &str) -> String {
    if s.len() <= SAMPLE_MAX_BYTES {
        s.to_string()
    } else {
        let mut t = s[..SAMPLE_MAX_BYTES].to_string();
        while !t.is_char_boundary(t.len()) && !t.is_empty() {
            t.pop();
        }
        t.push('…');
        t
    }
}

fn looks_like_non_phone(s: &str) -> bool {
    // RFC4122 UUID
    if s.len() == 36 && s.matches('-').count() == 4 {
        return true;
    }
    // ISO 8601 timestamp (anywhere in the string, not just at the start)
    if RX_ISO_TS.is_match(s) {
        return true;
    }
    // Bare ISO date `2026-05-16` (anywhere) — Insight's error messages
    // embed these in template strings like `dev smoke @ 2026-05-16T...`
    if RX_ISO_DATE.is_match(s) {
        return true;
    }
    // Semver-like build id `5.4.26051603` or `5.4.26051603+349`. Three
    // dot-separated components, last component ≥ 6 digits → build/date.
    if RX_BUILD_VERSION.is_match(s) {
        return true;
    }
    // Hostname / FQDN with dashed-IP subdomain `10-227-60-214.host.com`.
    if RX_HOSTNAME.is_match(s) {
        return true;
    }
    false
}

static RX_ISO_TS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}").unwrap()
});
static RX_ISO_DATE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b\d{4}-\d{2}-\d{2}\b").unwrap());
static RX_BUILD_VERSION: Lazy<Regex> = Lazy::new(|| {
    // major.minor.<6+ digits>  optionally with +build suffix.
    Regex::new(r"\b\d+\.\d+\.\d{6,}(?:\+\w+)?\b").unwrap()
});
static RX_HOSTNAME: Lazy<Regex> = Lazy::new(|| {
    // <something>.<word>.<tld> where <something> contains dashes/digits.
    Regex::new(r"\b[\w\-]+(?:\.[\w\-]+){2,}\.[a-z]{2,24}\b").unwrap()
});

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds_for(payload: &Value) -> Vec<String> {
        scan_payload(payload).into_iter().map(|f| f.kind).collect()
    }

    #[test]
    fn flags_real_phone_in_message() {
        let p = serde_json::json!({"error": {"message": "call +1-415-555-1234 now"}});
        assert!(kinds_for(&p).contains(&"phone".to_string()));
    }

    #[test]
    fn flags_email() {
        let p = serde_json::json!({"user": {"email": "alice@example.com"}});
        assert!(kinds_for(&p).contains(&"email".to_string()));
    }

    // v0.9.8 regression coverage — Insight 2026-05-16 false positives.

    #[test]
    fn does_not_flag_app_release_as_phone() {
        let p = serde_json::json!({"release": "focus-ai-app@5.4.26051603+349"});
        assert!(!kinds_for(&p).contains(&"phone".to_string()));
    }

    #[test]
    fn does_not_flag_app_version_as_phone() {
        let p = serde_json::json!({"app": {"version": "5.4.26051603"}});
        assert!(!kinds_for(&p).contains(&"phone".to_string()));
    }

    #[test]
    fn does_not_flag_iso_date_embedded_in_message_as_phone() {
        let p = serde_json::json!({
            "error": {"message": "sentori dev smoke @ 2026-05-16T12:46:30Z"}
        });
        assert!(!kinds_for(&p).contains(&"phone".to_string()));
    }

    #[test]
    fn does_not_flag_ip_dashed_subdomain_as_phone() {
        let p = serde_json::json!({
            "breadcrumbs": [
                {"data": {"url": "https://10-227-60-214.device.focusai.com/api/health"}}
            ]
        });
        assert!(!kinds_for(&p).contains(&"phone".to_string()));
    }

    #[test]
    fn does_not_flag_uuid_as_phone() {
        let p = serde_json::json!({
            "data": {"trace_id": "12345678-1234-1234-1234-1234567890ab"}
        });
        assert!(!kinds_for(&p).contains(&"phone".to_string()));
    }
}
