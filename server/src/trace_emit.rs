// Phase 37 sub-A: server self-instrument span emitter.
//
// Axum middleware (see `tracing_middleware.rs`) calls `try_push` for
// each request; this module owns the buffer and the background flush
// task that bulk-inserts the buffered spans into the spans / traces
// tables. The result is that the dashboard's trace list shows
// sentori-server's own request handling as if it were any other
// traced workload — the closed dogfood loop.

use std::sync::Arc;

use serde_json::Value as JsonValue;
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Maximum batched spans before a forced flush. The cron also flushes
/// every `FLUSH_INTERVAL` regardless of count.
const FLUSH_THRESHOLD: usize = 200;
/// Periodic flush interval.
const FLUSH_INTERVAL_SECS: u64 = 30;

#[derive(Clone, Debug)]
pub struct EmitSpan {
    pub id: Uuid,
    pub trace_id: Uuid,
    pub parent_span_id: Option<Uuid>,
    pub op: String,
    pub name: String,
    pub started_at: OffsetDateTime,
    pub duration_ms: i32,
    pub status: String,
    pub tags: JsonValue,
}

#[derive(Clone)]
pub struct SpanEmitter {
    project_id: Uuid,
    buffer: Arc<Mutex<Vec<EmitSpan>>>,
    pool: PgPool,
}

impl SpanEmitter {
    pub fn spawn(pool: PgPool, project_id: Uuid) -> Self {
        let buffer = Arc::new(Mutex::new(Vec::<EmitSpan>::with_capacity(FLUSH_THRESHOLD)));
        let me = Self {
            project_id,
            buffer: buffer.clone(),
            pool: pool.clone(),
        };
        let bg = me.clone();
        tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(std::time::Duration::from_secs(FLUSH_INTERVAL_SECS));
            loop {
                ticker.tick().await;
                if let Err(e) = bg.flush().await {
                    tracing::warn!(error = %e, "self-trace flush failed");
                }
            }
        });
        me
    }

    /// Push a span onto the buffer. If the buffer crosses
    /// `FLUSH_THRESHOLD`, fire a flush in a detached task so the
    /// hot HTTP path stays under-ms. Idempotent across concurrent
    /// callers (Mutex-guarded).
    pub fn try_push(&self, span: EmitSpan) {
        let buf = self.buffer.clone();
        let me = self.clone();
        tokio::spawn(async move {
            let mut g = buf.lock().await;
            g.push(span);
            if g.len() >= FLUSH_THRESHOLD {
                let drained: Vec<EmitSpan> = g.drain(..).collect();
                drop(g);
                if let Err(e) = me.flush_batch(drained).await {
                    tracing::warn!(error = %e, "self-trace burst flush failed");
                }
            }
        });
    }

    async fn flush(&self) -> Result<(), sqlx::Error> {
        let drained: Vec<EmitSpan> = {
            let mut g = self.buffer.lock().await;
            if g.is_empty() {
                return Ok(());
            }
            std::mem::take(&mut *g)
        };
        self.flush_batch(drained).await
    }

    async fn flush_batch(&self, spans: Vec<EmitSpan>) -> Result<(), sqlx::Error> {
        if spans.is_empty() {
            return Ok(());
        }
        // One transaction: insert all spans, then UPSERT the traces
        // summary table once per distinct trace.
        let mut tx = self.pool.begin().await?;

        for s in &spans {
            sqlx::query(
                r#"
                INSERT INTO spans
                    (id, project_id, trace_id, parent_span_id, started_at,
                     duration_ms, op, name, status, tags, data, traceparent)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL)
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(s.id)
            .bind(self.project_id)
            .bind(s.trace_id)
            .bind(s.parent_span_id)
            .bind(s.started_at)
            .bind(s.duration_ms)
            .bind(&s.op)
            .bind(&s.name)
            .bind(&s.status)
            .bind(&s.tags)
            .execute(&mut *tx)
            .await?;

            let is_root = s.parent_span_id.is_none();
            let root_op: Option<&str> = if is_root { Some(&s.op) } else { None };
            let root_name: Option<&str> = if is_root { Some(&s.name) } else { None };
            let root_duration: i32 = if is_root { s.duration_ms } else { 0 };

            sqlx::query(
                r#"
                INSERT INTO traces
                    (trace_id, project_id, root_op, root_name,
                     first_seen, last_seen, span_count, status, duration_ms)
                VALUES
                    ($1, $2, $3, $4, now(), now(), 1, $5, $6)
                ON CONFLICT (trace_id) DO UPDATE SET
                    last_seen   = GREATEST(traces.last_seen, EXCLUDED.last_seen),
                    span_count  = traces.span_count + 1,
                    root_op     = COALESCE(EXCLUDED.root_op, traces.root_op),
                    root_name   = COALESCE(EXCLUDED.root_name, traces.root_name),
                    duration_ms = GREATEST(traces.duration_ms, EXCLUDED.duration_ms),
                    status      = CASE
                        WHEN traces.status = 'error' OR EXCLUDED.status = 'error' THEN 'error'
                        WHEN traces.status = 'cancelled' OR EXCLUDED.status = 'cancelled' THEN 'cancelled'
                        ELSE 'ok'
                    END
                "#,
            )
            .bind(s.trace_id)
            .bind(self.project_id)
            .bind(root_op)
            .bind(root_name)
            .bind(&s.status)
            .bind(root_duration)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        tracing::debug!(count = spans.len(), "self-trace batch flushed");
        Ok(())
    }
}

/// Decode a W3C traceparent header (`00-<32hex>-<16hex>-<flags>`).
/// Returns `(trace_id, parent_span_id)`. The 16-hex parent-id is
/// zero-padded back to a 32-hex uuid so it can fit in the uuid
/// column — lossy mapping but acceptable for inter-system stitching.
pub fn parse_traceparent(header: &str) -> Option<(Uuid, Uuid)> {
    let parts: Vec<&str> = header.trim().split('-').collect();
    if parts.len() != 4 || parts[0] != "00" {
        return None;
    }
    if parts[1].len() != 32 || parts[2].len() != 16 {
        return None;
    }
    let trace_hex = format!(
        "{}-{}-{}-{}-{}",
        &parts[1][0..8],
        &parts[1][8..12],
        &parts[1][12..16],
        &parts[1][16..20],
        &parts[1][20..32],
    );
    let trace_id = Uuid::parse_str(&trace_hex).ok()?;
    // 16 hex parent-id → expand into a 32-hex uuid, padding zeros.
    let padded = format!("{}{}", parts[2], "0".repeat(16));
    let parent_hex = format!(
        "{}-{}-{}-{}-{}",
        &padded[0..8],
        &padded[8..12],
        &padded[12..16],
        &padded[16..20],
        &padded[20..32],
    );
    let parent_span_id = Uuid::parse_str(&parent_hex).ok()?;
    Some((trace_id, parent_span_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_traceparent() {
        let r = parse_traceparent("00-0123456789abcdef0123456789abcdef-fedcba9876543210-01");
        assert!(r.is_some());
        let (trace, parent) = r.unwrap();
        assert_eq!(trace.to_string(), "01234567-89ab-cdef-0123-456789abcdef");
        // 16-hex span "fedcba9876543210" padded with 16 zeros →
        // 32-hex "fedcba98765432100000000000000000".
        assert_eq!(parent.to_string(), "fedcba98-7654-3210-0000-000000000000");
    }

    #[test]
    fn rejects_wrong_field_count() {
        assert!(parse_traceparent("00-aaa-bbb").is_none());
        assert!(parse_traceparent("00-a-b-c-d-e").is_none());
    }

    #[test]
    fn rejects_wrong_version() {
        assert!(parse_traceparent("99-0123456789abcdef0123456789abcdef-fedcba9876543210-01").is_none());
    }

    #[test]
    fn rejects_wrong_trace_id_length() {
        assert!(parse_traceparent("00-short-fedcba9876543210-01").is_none());
    }

    #[test]
    fn rejects_wrong_span_id_length() {
        assert!(parse_traceparent("00-0123456789abcdef0123456789abcdef-short-01").is_none());
    }

    #[test]
    fn ignores_unknown_flags() {
        // Spec says clients must accept any flags byte. We don't read
        // it back today but parsing should not fail.
        assert!(parse_traceparent("00-0123456789abcdef0123456789abcdef-fedcba9876543210-ff").is_some());
        assert!(parse_traceparent("00-0123456789abcdef0123456789abcdef-fedcba9876543210-00").is_some());
    }

    fn make_emit(span_id: &str, parent: Option<&str>, op: &str, status: &str) -> EmitSpan {
        EmitSpan {
            id: Uuid::parse_str(span_id).unwrap(),
            trace_id: Uuid::parse_str("aaaaaaaa-aaaa-7000-8000-000000000000").unwrap(),
            parent_span_id: parent.map(|s| Uuid::parse_str(s).unwrap()),
            op: op.into(),
            name: format!("test {op}"),
            started_at: OffsetDateTime::now_utc(),
            duration_ms: 42,
            status: status.into(),
            tags: serde_json::json!({}),
        }
    }

    // Compile-time sanity: EmitSpan is Clone + Send + Sync so we can
    // ferry it across the spawn boundary.
    #[allow(dead_code)]
    fn assert_send_sync() {
        fn require<T: Send + Sync + Clone>() {}
        require::<EmitSpan>();
    }

    #[test]
    fn emit_span_shape_compiles() {
        let _ = make_emit(
            "11111111-1111-7111-8000-000000000000",
            None,
            "http.server",
            "ok",
        );
    }
}
