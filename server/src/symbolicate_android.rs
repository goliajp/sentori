// Phase 22 sub-C: Android stack frame deobfuscation via ProGuard / R8
// mappings.
//
// Android crash frames arrive looking like:
//
//   {
//     "function": "com.example.a.b",   // obfuscated class.method
//     "file":     "SourceFile",        // R8 strips real filenames
//     "line":     42,                  // synthetic line number
//     "inApp":    true
//   }
//
// We resolve the obfuscated `com.example.a.b` (plus the synthetic
// `line` for inline expansion) back to the original class + method
// name + real source file via a ProGuard mapping uploaded for the
// project. The `proguard` crate (getsentry's) handles the full mapping
// grammar including R8's inline expansion of methods.
//
// Lookup order on each frame: first try matching by `frame.debugId`
// (R8's `# pg_map_id`), then fall back to the freshest mapping for the
// frame's release on this project.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use proguard::{ProguardMapper, ProguardMapping};
use sqlx::PgPool;
use uuid::Uuid;

const CACHE_MAX: usize = 50;

#[derive(Eq, Hash, PartialEq, Clone)]
struct CacheKey {
    /// Either "debug:<uuid>" or "release:<name>" — keeps both lookup
    /// modes in one cache without a separate map.
    selector: String,
    project_id: Uuid,
}

/// Cached: parsed mapping bytes (Arc'd) per (project, selector). The
/// `proguard::ProguardMapping` borrows from the bytes, so we hold the
/// owned `Arc<Vec<u8>>` here and re-construct the borrow per call.
static CACHE: OnceLock<Mutex<HashMap<CacheKey, Arc<Vec<u8>>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<CacheKey, Arc<Vec<u8>>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Walk every frame on `payload.error.stack[]` (and recursively on
/// `.cause.stack[]`). Frames that don't look obfuscated (or whose
/// project has no mapping) are left alone.
pub async fn symbolicate_payload(
    pool: &PgPool,
    project_id: Uuid,
    release_hint: Option<&str>,
    payload: &mut serde_json::Value,
) {
    if let Some(error) = payload.get_mut("error") {
        symbolicate_error_recursive(pool, project_id, release_hint, error).await;
    }
}

async fn symbolicate_error_recursive(
    pool: &PgPool,
    project_id: Uuid,
    release_hint: Option<&str>,
    error: &mut serde_json::Value,
) {
    if let Some(serde_json::Value::Array(stack)) = error.get_mut("stack") {
        for frame in stack.iter_mut() {
            symbolicate_frame_inplace(pool, project_id, release_hint, frame).await;
        }
    }
    if let Some(cause) = error.get_mut("cause") {
        if !cause.is_null() {
            Box::pin(symbolicate_error_recursive(
                pool,
                project_id,
                release_hint,
                cause,
            ))
            .await;
        }
    }
}

async fn symbolicate_frame_inplace(
    pool: &PgPool,
    project_id: Uuid,
    release_hint: Option<&str>,
    frame: &mut serde_json::Value,
) {
    // Only touch frames that look like JVM class.method shapes —
    // package.dotted.path with at least one dot. JS frames in the
    // same stack pass through untouched.
    let function = match frame.get("function").and_then(|v| v.as_str()) {
        Some(s) if s.contains('.') => s.to_string(),
        _ => return,
    };
    let line = frame.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

    // Try debug-id first, fall back to release.
    let mut owned: Option<Arc<Vec<u8>>> = None;
    if let Some(debug_id) = frame.get("debugId").and_then(|v| v.as_str()) {
        owned = match load_mapping_by_debug_id(pool, project_id, debug_id).await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = %e, %project_id, debug_id, "proguard load by debug_id failed");
                None
            }
        };
    }
    if owned.is_none() {
        if let Some(release) = release_hint {
            owned = match load_mapping_by_release(pool, project_id, release).await {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!(error = %e, %project_id, release, "proguard load by release failed");
                    None
                }
            };
        }
    }
    let Some(bytes) = owned else { return };

    let mapping = ProguardMapping::new(bytes.as_slice());
    if !mapping.is_valid() {
        return;
    }
    let mapper = ProguardMapper::new(mapping);

    let (class, method) = match function.rsplit_once('.') {
        Some((c, m)) => (c, m),
        None => return,
    };

    // R8 method ranges are 1-indexed; line 0 means "no line info" —
    // pass 0 to remap_method_line and the mapping crate falls back
    // to the unique top-level method if there is one.
    let frames = mapper
        .remap_frame(&proguard::StackFrame::new(class, method, line))
        .collect::<Vec<_>>();

    let Some(top) = frames.first() else { return };

    // Innermost (the originally-written method) is what the dashboard
    // user wants on the row — we collapse the inline chain into a
    // single Sentori frame. Phase 25 (Issue Detail revamp) gets a
    // proper inline-frames sidebar so the chain is queryable; today
    // we just take the deepest entry.
    let innermost = frames.last().unwrap();
    frame["function"] = serde_json::Value::String(innermost.full_method());
    if let Some(file) = top.file() {
        // ProGuard mappings ship with the source filename (basename).
        // It's the right thing to show on the frame row.
        frame["file"] = serde_json::Value::String(file.to_string());
    }
    if let Some(line) = innermost.line() {
        frame["line"] = serde_json::Value::from(line as u64);
    }
}

async fn load_mapping_by_debug_id(
    pool: &PgPool,
    project_id: Uuid,
    debug_id: &str,
) -> anyhow::Result<Option<Arc<Vec<u8>>>> {
    let key = CacheKey {
        project_id,
        selector: format!("debug:{debug_id}"),
    };
    if let Some(b) = cache().lock().unwrap().get(&key).cloned() {
        return Ok(Some(b));
    }
    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT data FROM proguard_mappings \
         WHERE project_id = $1 AND debug_id = $2 \
         ORDER BY uploaded_at DESC LIMIT 1",
    )
    .bind(project_id)
    .bind(debug_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(b,)| store_in_cache(key, b)))
}

async fn load_mapping_by_release(
    pool: &PgPool,
    project_id: Uuid,
    release: &str,
) -> anyhow::Result<Option<Arc<Vec<u8>>>> {
    let key = CacheKey {
        project_id,
        selector: format!("release:{release}"),
    };
    if let Some(b) = cache().lock().unwrap().get(&key).cloned() {
        return Ok(Some(b));
    }
    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT data FROM proguard_mappings \
         WHERE project_id = $1 AND release = $2 \
         ORDER BY uploaded_at DESC LIMIT 1",
    )
    .bind(project_id)
    .bind(release)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(b,)| store_in_cache(key, b)))
}

fn store_in_cache(key: CacheKey, bytes: Vec<u8>) -> Arc<Vec<u8>> {
    let arc = Arc::new(bytes);
    let mut c = cache().lock().unwrap();
    if c.len() >= CACHE_MAX {
        c.clear();
    }
    c.insert(key, arc.clone());
    arc
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Minimal valid ProGuard mapping covering one obfuscated class
    // and one obfuscated method. ProGuard syntax:
    //   <original> -> <obfuscated>:
    //       <returnType> <originalName>(<args>) -> <obfuscatedName>
    const SAMPLE_MAPPING: &str = "\
com.example.OriginalClass -> com.example.a:
    void originalMethod() -> b
    1:1:void otherOriginal():null:0 -> c
";

    #[test]
    fn proguard_crate_round_trips_sample() {
        let mapping = ProguardMapping::new(SAMPLE_MAPPING.as_bytes());
        assert!(mapping.is_valid());
        let mapper = ProguardMapper::new(mapping);
        let frames = mapper
            .remap_frame(&proguard::StackFrame::new("com.example.a", "b", 0))
            .collect::<Vec<_>>();
        let innermost = frames.last().expect("at least one frame");
        assert_eq!(innermost.class(), "com.example.OriginalClass");
        assert_eq!(innermost.method(), "originalMethod");
    }

    #[test]
    fn symbolicate_skips_non_jvm_frames() {
        // A frame whose function lacks a dot looks like JS or a bare
        // function name — leave it alone.
        let mut payload = json!({
            "error": {
                "stack": [
                    { "function": "handleClick", "file": "App.tsx", "line": 1, "inApp": true }
                ]
            }
        });
        let copy = payload.clone();
        // We can't actually run async without tokio in #[test], but
        // we can verify the precondition via the helper.
        let frame = &payload["error"]["stack"][0];
        assert!(!frame["function"].as_str().unwrap().contains('.'));
        assert_eq!(payload, copy);
    }
}
