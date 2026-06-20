// v1.3 W15 — lazy-extract source bundle lookups.
//
// v1.2 W3.b loaded the whole tar.gz into a HashMap<path, String> at
// first lookup and pinned that map in a per-(release, platform)
// process cache. That works fine for the typical 5-10 MB iOS bundle
// but a 64 MB tar.gz of a polyglot monorepo can decompress to
// hundreds of MB of source text — multiplied across cached bundles
// it becomes a real memory hog.
//
// v1.3 W15 swaps the strategy: cache only a lightweight *path
// index* (a Vec<String> of entry paths, sufficient for suffix +
// basename resolution). File bodies are extracted on demand by
// re-decompressing the archive and reading exactly one entry. Each
// lookup pays a one-shot decompression cost; the upside is bounded
// memory regardless of bundle size or how many bundles are loaded
// concurrently.
//
// Path matching: unchanged. dSYM and Proguard mappings carry the
// build-machine path for each source file; operator-built archives
// hold relative paths. Strategy: longest suffix match across paths,
// fall back to basename.

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, OnceLock};

use flate2::read::GzDecoder;
use sqlx::PgPool;
use uuid::Uuid;

const CACHE_MAX: usize = 32;

/// All path metadata for a bundle. Path strings are small — for a
/// 10k-file bundle this index is ~300 KB.
#[derive(Default)]
pub struct PathIndex {
    paths: Vec<String>,
}

impl PathIndex {
    pub fn from_tar_gz(bytes: &[u8]) -> anyhow::Result<Self> {
        let gz = GzDecoder::new(bytes);
        let mut tar = tar::Archive::new(gz);
        let mut paths = Vec::new();
        for entry in tar.entries()? {
            let entry = entry?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let path = entry.path()?.to_string_lossy().replace('\\', "/");
            paths.push(path);
        }
        Ok(Self { paths })
    }

    pub fn resolve(&self, wanted: &str) -> Option<&str> {
        let wanted_norm = wanted.replace('\\', "/");
        let trimmed = wanted_norm.trim_start_matches('/');
        // Longest-suffix match.
        let mut best: Option<&str> = None;
        for p in &self.paths {
            if trimmed == p.as_str() || trimmed.ends_with(&format!("/{}", p.as_str())) {
                if best.is_none_or(|b| p.len() > b.len()) {
                    best = Some(p.as_str());
                }
            }
        }
        if best.is_some() {
            return best;
        }
        // Fall back to basename — pick the longest match (deepest path).
        let base = wanted_norm.rsplit('/').next()?;
        if base.is_empty() {
            return None;
        }
        let mut basename_matches: Vec<&String> = self
            .paths
            .iter()
            .filter(|k| k.rsplit('/').next() == Some(base))
            .collect();
        basename_matches.sort_by_key(|k| std::cmp::Reverse(k.len()));
        basename_matches.first().map(|k| k.as_str())
    }

    pub fn entry_count(&self) -> usize {
        self.paths.len()
    }
}

#[derive(Debug)]
pub struct SourceWindow {
    pub file: String,
    pub line: u32,
    pub before: Vec<String>,
    pub at: String,
    pub after: Vec<String>,
}

#[derive(Eq, Hash, PartialEq, Clone)]
struct CacheKey {
    release_id: Uuid,
    platform: String,
}

static INDEX_CACHE: OnceLock<Mutex<HashMap<CacheKey, Arc<PathIndex>>>> = OnceLock::new();

fn index_cache() -> &'static Mutex<HashMap<CacheKey, Arc<PathIndex>>> {
    INDEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Look up the source window for a native frame. Returns `Ok(None)`
/// when no bundle has been uploaded for this (release, platform) or
/// the requested file/line isn't in any uploaded bundle.
///
/// v1.4 W25: file extraction uses spawn_blocking + std::fs::File
/// streaming so the gz decompressor doesn't block the tokio runtime.
/// v1.4 W26: tries every (release, platform) bundle until one
/// resolves; module-labelled bundles + the unlabelled main bundle
/// coexist.
pub async fn lookup(
    pool: &PgPool,
    release_id: Uuid,
    platform: &str,
    file: &str,
    line: u32,
    n: usize,
) -> anyhow::Result<Option<SourceWindow>> {
    let bundles = load_all_bundles(pool, release_id, platform).await?;
    if bundles.is_empty() {
        return Ok(None);
    }
    for (index, blob_path) in &bundles {
        let Some(resolved) = index.resolve(file) else {
            continue;
        };
        let resolved = resolved.to_string();
        let body = extract_one_streaming(blob_path, &resolved).await?;
        let Some(body) = body else { continue };
        return Ok(window_from_body(&body, &resolved, line, n));
    }
    Ok(None)
}

async fn extract_one_streaming(blob_path: &str, wanted: &str) -> anyhow::Result<Option<String>> {
    let path = blob_path.to_string();
    let want = wanted.to_string();
    tokio::task::spawn_blocking(move || -> anyhow::Result<Option<String>> {
        let file = std::fs::File::open(&path)?;
        let gz = GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        for entry in tar.entries()? {
            let mut entry = entry?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let p = entry.path()?.to_string_lossy().replace('\\', "/");
            if p == want {
                let mut s = String::new();
                if entry.read_to_string(&mut s).is_err() {
                    return Ok(None);
                }
                return Ok(Some(s));
            }
        }
        Ok(None)
    })
    .await?
}

// `extract_one` (sync, in-memory) lived here in v1.3 W15. v1.4 W25
// replaces it with `extract_one_streaming` which uses
// spawn_blocking + std::fs::File so the gz decompressor doesn't
// block the tokio runtime.

fn window_from_body(body: &str, resolved: &str, line: u32, n: usize) -> Option<SourceWindow> {
    if line == 0 {
        return None;
    }
    let lines: Vec<&str> = body.lines().collect();
    let center = (line - 1) as usize;
    if center >= lines.len() {
        return None;
    }
    let start = center.saturating_sub(n);
    let end = (center + n + 1).min(lines.len());
    Some(SourceWindow {
        after: lines[(center + 1)..end].iter().map(|s| s.to_string()).collect(),
        at: lines[center].to_string(),
        before: lines[start..center].iter().map(|s| s.to_string()).collect(),
        file: resolved.to_string(),
        line,
    })
}

/// v1.4 W26 — lookup() now consults ALL bundles for a (release,
/// platform), in upload order. The first one whose path_index can
/// resolve `wanted` wins. Caches each bundle's path index
/// independently so the next lookup on a different file (or same
/// file again) reuses prior decompressions.
async fn load_all_bundles(
    pool: &PgPool,
    release_id: Uuid,
    platform: &str,
) -> anyhow::Result<Vec<(Arc<PathIndex>, String)>> {
    let kind = format!("source_bundle_{platform}");
    let rows: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT id, blob_path, module_label FROM release_artifacts \
         WHERE release_id = $1 AND kind = $2 \
         ORDER BY id ASC",
    )
    .bind(release_id)
    .bind(&kind)
    .fetch_all(pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, blob_path, _module) in rows {
        let key = CacheKey {
            platform: format!("{platform}:{id}"),
            release_id,
        };
        if let Some(idx) = index_cache().lock().unwrap().get(&key).cloned() {
            out.push((idx, blob_path));
            continue;
        }
        let idx = Arc::new(load_index_streaming(&blob_path).await?);
        {
            let mut c = index_cache().lock().unwrap();
            if c.len() >= CACHE_MAX {
                c.clear();
            }
            c.insert(key, idx.clone());
        }
        out.push((idx, blob_path));
    }
    Ok(out)
}

/// v1.4 W25 — true streaming: open the file, hand it to tar
/// inside spawn_blocking so the sync decompressor doesn't block
/// the tokio runtime. Doesn't buffer the whole file into memory.
async fn load_index_streaming(blob_path: &str) -> anyhow::Result<PathIndex> {
    let path = blob_path.to_string();
    tokio::task::spawn_blocking(move || -> anyhow::Result<PathIndex> {
        let file = std::fs::File::open(&path)?;
        let gz = GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        let mut paths = Vec::new();
        for entry in tar.entries()? {
            let entry = entry?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let p = entry.path()?.to_string_lossy().replace('\\', "/");
            paths.push(p);
        }
        Ok(PathIndex { paths })
    })
    .await?
}

/// v1.3 W15: stats computed at upload time so the dashboard panel
/// can show "n files · M MB" without re-extracting.
#[derive(Debug, Clone, Copy, Default)]
pub struct BundleStats {
    pub entry_count: i32,
    pub uncompressed_size_bytes: i64,
}

pub fn stats_for(tar_gz_bytes: &[u8]) -> anyhow::Result<BundleStats> {
    let gz = GzDecoder::new(tar_gz_bytes);
    let mut tar = tar::Archive::new(gz);
    let mut count: i32 = 0;
    let mut total: i64 = 0;
    for entry in tar.entries()? {
        let entry = entry?;
        if entry.header().entry_type().is_file() {
            count = count.saturating_add(1);
            total = total.saturating_add(entry.header().size().unwrap_or(0) as i64);
        }
    }
    Ok(BundleStats {
        entry_count: count,
        uncompressed_size_bytes: total,
    })
}

/// Map a frame's file path to a platform marker recognised by the
/// upload path. Returns `None` for non-native extensions (JS/TS
/// source — the sourcemap path handles those).
pub fn platform_for_file(file: &str) -> Option<&'static str> {
    let lower = file.to_lowercase();
    if lower.ends_with(".swift")
        || lower.ends_with(".m")
        || lower.ends_with(".mm")
        || lower.ends_with(".h")
        || lower.ends_with(".hpp")
    {
        Some("ios")
    } else if lower.ends_with(".kt") || lower.ends_with(".java") {
        Some("android")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_tar_gz(entries: &[(&str, &str)]) -> Vec<u8> {
        let buf: Vec<u8> = Vec::new();
        let enc = flate2::write::GzEncoder::new(buf, flate2::Compression::default());
        let mut tar = tar::Builder::new(enc);
        for (path, body) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            tar.append_data(&mut header, path, body.as_bytes()).unwrap();
        }
        let mut enc = tar.into_inner().unwrap();
        enc.flush().unwrap();
        enc.finish().unwrap()
    }

    #[test]
    fn path_index_resolves_suffix() {
        let bytes = build_tar_gz(&[
            ("ios/Sources/MyApp/Foo.swift", "x"),
            ("ios/Sources/Other.swift", "y"),
        ]);
        let idx = PathIndex::from_tar_gz(&bytes).unwrap();
        let r = idx
            .resolve("/Users/ci/work/my-org/ios/Sources/MyApp/Foo.swift")
            .unwrap();
        assert_eq!(r, "ios/Sources/MyApp/Foo.swift");
    }

    #[test]
    fn path_index_basename_fallback() {
        let bytes = build_tar_gz(&[("a/Bar.kt", "x"), ("nested/deep/path/Bar.kt", "y")]);
        let idx = PathIndex::from_tar_gz(&bytes).unwrap();
        let r = idx.resolve("/totally/different/Bar.kt").unwrap();
        // Picks the longest path on basename ties.
        assert_eq!(r, "nested/deep/path/Bar.kt");
    }

    // v1.4 W25 — `extract_one` (the in-memory helper) was replaced
    // by `extract_one_streaming(blob_path)` which reads from disk.
    // We exercise it here by writing the test archive to a temp
    // file and then calling the streaming path. This keeps the test
    // surface honest about what production actually runs.
    #[test]
    fn extract_one_streaming_returns_matching_file() {
        let bytes = build_tar_gz(&[("a.swift", "alpha\nbeta\n"), ("b.swift", "gamma\n")]);
        let dir = std::env::temp_dir().join(format!("sentori-sb-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bundle.tar.gz");
        std::fs::write(&path, &bytes).unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let body = rt
            .block_on(extract_one_streaming(path.to_str().unwrap(), "a.swift"))
            .unwrap()
            .unwrap();
        assert_eq!(body, "alpha\nbeta\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_one_streaming_returns_none_for_missing() {
        let bytes = build_tar_gz(&[("a.swift", "x\n")]);
        let dir = std::env::temp_dir().join(format!("sentori-sb-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bundle.tar.gz");
        std::fs::write(&path, &bytes).unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let r = rt
            .block_on(extract_one_streaming(path.to_str().unwrap(), "missing.swift"))
            .unwrap();
        assert!(r.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn window_from_body_picks_correct_lines() {
        let body = "line1\nline2\nline3\nline4\nline5\n";
        let w = window_from_body(body, "a.swift", 3, 1).unwrap();
        assert_eq!(w.at, "line3");
        assert_eq!(w.before, vec!["line2".to_string()]);
        assert_eq!(w.after, vec!["line4".to_string()]);
    }

    #[test]
    fn stats_counts_files_and_sum() {
        let bytes = build_tar_gz(&[("a.swift", "12345"), ("b.swift", "abc")]);
        let s = stats_for(&bytes).unwrap();
        assert_eq!(s.entry_count, 2);
        assert_eq!(s.uncompressed_size_bytes, 8);
    }

    #[test]
    fn platform_for_file_detects_ios_vs_android() {
        assert_eq!(platform_for_file("a.swift"), Some("ios"));
        assert_eq!(platform_for_file("AppDelegate.m"), Some("ios"));
        assert_eq!(platform_for_file("MainActivity.kt"), Some("android"));
        assert_eq!(platform_for_file("Foo.java"), Some("android"));
        assert_eq!(platform_for_file("app.js"), None);
    }
}
