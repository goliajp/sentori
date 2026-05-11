use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use sourcemap::SourceMap;
use sqlx::PgPool;
use uuid::Uuid;

const CACHE_MAX: usize = 50;

/// Process-wide cache keyed by release_id. Loads the (single) sourcemap
/// uploaded for a release on first use; cleared wholesale when the cache
/// hits CACHE_MAX (simple eviction is fine while CACHE_MAX is small).
static CACHE: OnceLock<Mutex<HashMap<Uuid, Arc<SourceMap>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<Uuid, Arc<SourceMap>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve `release_name` to a release id and, if a sourcemap is uploaded
/// for it, walk `payload.error.stack[]` (and any nested `.cause.stack[]`)
/// and rewrite each frame's file/line/column/function in place.
/// Best-effort: any DB or sourcemap parse failure is swallowed.
pub async fn symbolicate_payload(
    pool: &PgPool,
    release_name: &str,
    payload: &mut serde_json::Value,
) -> anyhow::Result<()> {
    let release_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM releases WHERE name = $1 LIMIT 1",
    )
    .bind(release_name)
    .fetch_optional(pool)
    .await?;

    let release_id = match release_id {
        Some(id) => id,
        None => return Ok(()),
    };

    let sm = match load_sourcemap_for_release(pool, release_id).await? {
        Some(sm) => sm,
        None => return Ok(()),
    };

    if let Some(error) = payload.get_mut("error") {
        symbolicate_error_recursive(&sm, error);
    }
    Ok(())
}

fn symbolicate_error_recursive(sm: &SourceMap, error: &mut serde_json::Value) {
    if let Some(serde_json::Value::Array(stack)) = error.get_mut("stack") {
        for frame in stack.iter_mut() {
            symbolicate_frame_inplace(sm, frame);
        }
    }
    if let Some(cause) = error.get_mut("cause") {
        if !cause.is_null() {
            symbolicate_error_recursive(sm, cause);
        }
    }
}

fn symbolicate_frame_inplace(sm: &SourceMap, frame: &mut serde_json::Value) {
    let line = frame.get("line").and_then(|v| v.as_u64()).unwrap_or(0);
    if line == 0 {
        return;
    }
    let column = frame.get("column").and_then(|v| v.as_u64()).unwrap_or(0);

    let token = match sm.lookup_token(line.saturating_sub(1) as u32, column as u32) {
        Some(t) => t,
        None => return,
    };

    if let Some(src) = token.get_source() {
        frame["file"] = serde_json::Value::String(src.to_string());
    }
    let src_line = (token.get_src_line() as u64).saturating_add(1);
    frame["line"] = serde_json::Value::from(src_line);
    frame["column"] = serde_json::Value::from(token.get_src_col() as u64);
    if let Some(name) = token.get_name() {
        frame["function"] = serde_json::Value::String(name.to_string());
    }
    // Symbolicated frames usually point at app source — flip inApp.
    frame["inApp"] = serde_json::Value::Bool(true);
}

/// Phase 25 sub-B: lift a window of original source around the
/// position the (raw) `line:column` reverse-maps to. Returns the
/// resolved file path (whatever the sourcemap names — usually a
/// `webpack:///src/...` style URL), 1-indexed `line` / `column` in
/// that file, and `before` / `at` / `after` line slices.
///
/// Source text comes from the sourcemap's embedded `sourcesContent`;
/// if the toolchain didn't embed it (rare for production source maps
/// since they default to `sourcesContent: true` on every modern
/// bundler), we return Ok(None) so the dashboard renders an "upload
/// a source-map with sourcesContent" hint instead of crashing.
#[derive(Debug)]
pub struct FrameSourceWindow {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub before: Vec<String>,
    pub at: String,
    pub after: Vec<String>,
}

pub async fn source_for_frame(
    pool: &PgPool,
    release_name: &str,
    raw_line: u32,
    raw_col: u32,
    context_lines: usize,
) -> anyhow::Result<Option<FrameSourceWindow>> {
    let release_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM releases WHERE name = $1 LIMIT 1",
    )
    .bind(release_name)
    .fetch_optional(pool)
    .await?;
    let Some(release_id) = release_id else {
        return Ok(None);
    };
    let Some(sm) = load_sourcemap_for_release(pool, release_id).await? else {
        return Ok(None);
    };
    Ok(window_from_sourcemap(&sm, raw_line, raw_col, context_lines))
}

/// Window-extraction helper that doesn't touch the DB — split out so
/// it's directly unit-testable. Same shape `source_for_frame` returns
/// after the DB / cache lookup resolves to a `SourceMap`.
fn window_from_sourcemap(
    sm: &SourceMap,
    raw_line: u32,
    raw_col: u32,
    context_lines: usize,
) -> Option<FrameSourceWindow> {
    let token = sm.lookup_token(raw_line.saturating_sub(1), raw_col)?;
    let src_line = token.get_src_line();
    let src_col = token.get_src_col();
    let file = token.get_source().map(|s| s.to_string()).unwrap_or_default();
    let view = sm.get_source_view(token.get_src_id())?;
    let source = view.source();
    let lines: Vec<&str> = source.lines().collect();
    if (src_line as usize) >= lines.len() {
        return None;
    }
    let center = src_line as usize;
    let start = center.saturating_sub(context_lines);
    let end = (center + context_lines + 1).min(lines.len());
    Some(FrameSourceWindow {
        after: lines[(center + 1)..end].iter().map(|s| s.to_string()).collect(),
        at: lines[center].to_string(),
        before: lines[start..center].iter().map(|s| s.to_string()).collect(),
        column: src_col + 1,
        file,
        line: src_line + 1,
    })
}

async fn load_sourcemap_for_release(
    pool: &PgPool,
    release_id: Uuid,
) -> anyhow::Result<Option<Arc<SourceMap>>> {
    let start = std::time::Instant::now();
    if let Some(sm) = cache().lock().unwrap().get(&release_id).cloned() {
        crate::metrics::symbolicate_duration(false, start.elapsed().as_secs_f64());
        return Ok(Some(sm));
    }

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT blob_path FROM release_artifacts \
         WHERE release_id = $1 AND kind = 'sourcemap' \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(release_id)
    .fetch_optional(pool)
    .await?;

    let blob_path = match row {
        Some((p,)) => p,
        None => {
            crate::metrics::symbolicate_duration(true, start.elapsed().as_secs_f64());
            return Ok(None);
        }
    };

    let bytes = tokio::fs::read(&blob_path).await?;
    let sm = SourceMap::from_reader(bytes.as_slice())?;
    let arc = Arc::new(sm);

    let mut c = cache().lock().unwrap();
    if c.len() >= CACHE_MAX {
        c.clear();
    }
    c.insert(release_id, arc.clone());
    crate::metrics::symbolicate_duration(true, start.elapsed().as_secs_f64());
    Ok(Some(arc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sourcemap::SourceMapBuilder;

    const SRC: &str = concat!(
        "// header\n",
        "function alpha() {\n",
        "  return 'a'\n",
        "}\n",
        "function beta() {\n",
        "  throw new Error('boom')\n",
        "}\n",
        "// footer\n",
    );

    fn synthetic_sourcemap() -> SourceMap {
        // bundle row 0 → original line 2 ("function alpha…")
        // bundle row 1 → original line 6 ("  throw new Error…")
        let mut b = SourceMapBuilder::new(Some("bundle.js"));
        let src_id = b.add_source("src/foo.ts");
        b.set_source_contents(src_id, Some(SRC));
        b.add_raw(0, 0, 1, 0, Some(src_id), None, false);
        b.add_raw(1, 0, 5, 0, Some(src_id), None, false);
        b.into_sourcemap()
    }

    #[test]
    fn window_returns_lines_around_resolved_position() {
        let sm = synthetic_sourcemap();
        // Bundle line 2 (1-indexed) → bundle row 1 → original line 6.
        let w = window_from_sourcemap(&sm, 2, 0, 2).expect("token resolves");
        assert_eq!(w.file, "src/foo.ts");
        assert_eq!(w.line, 6);
        assert_eq!(w.at, "  throw new Error('boom')");
        // 2 lines of context above → "}" closing alpha + the beta header.
        assert_eq!(
            w.before,
            vec!["}".to_string(), "function beta() {".to_string()],
        );
        assert!(w.after.first().is_some_and(|s| s.contains('}')));
    }

    #[test]
    fn window_clamps_at_file_boundaries() {
        let sm = synthetic_sourcemap();
        // Bundle line 1 → original line 2; with 5-line context, before is
        // clamped to the single line that exists above (line 1).
        let w = window_from_sourcemap(&sm, 1, 0, 5).expect("token resolves");
        assert_eq!(w.before.len(), 1, "before clamped at start of file");
        assert!(!w.after.is_empty());
    }
}
