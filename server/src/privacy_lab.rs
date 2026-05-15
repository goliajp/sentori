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
    // Loose: 7-15 digits with optional +/-/space/parens grouping.
    Regex::new(r"(?:\+?[0-9]{1,3}[ \-]?)?(?:\(?[0-9]{2,4}\)?[ \-]?){2,4}[0-9]{2,4}").unwrap()
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
        // The phone regex is very loose. Filter strings that are
        // unlikely to be phones: < 7 digits total, or part of a known
        // non-PII pattern (timestamps, UUIDs).
        let digit_count = candidate.chars().filter(|c| c.is_ascii_digit()).count();
        if digit_count >= 7 && digit_count <= 15 && !looks_like_uuid_or_ts(s) {
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

fn looks_like_uuid_or_ts(s: &str) -> bool {
    // crude — covers RFC4122 UUIDs and ISO 8601 timestamps so we
    // don't flag them as phone numbers.
    if s.len() == 36 && s.matches('-').count() == 4 {
        return true;
    }
    if s.starts_with("20") && s.contains('T') && s.contains(':') {
        return true;
    }
    false
}
