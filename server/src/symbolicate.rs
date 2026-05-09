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

async fn load_sourcemap_for_release(
    pool: &PgPool,
    release_id: Uuid,
) -> anyhow::Result<Option<Arc<SourceMap>>> {
    if let Some(sm) = cache().lock().unwrap().get(&release_id).cloned() {
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
        None => return Ok(None),
    };

    let bytes = tokio::fs::read(&blob_path).await?;
    let sm = SourceMap::from_reader(bytes.as_slice())?;
    let arc = Arc::new(sm);

    let mut c = cache().lock().unwrap();
    if c.len() >= CACHE_MAX {
        c.clear();
    }
    c.insert(release_id, arc.clone());
    Ok(Some(arc))
}
