// Phase 22 sub-B: iOS DWARF symbolication.
//
// Frames from the SDK's native iOS crash handler arrive with these
// optional fields (extension to docs/protocol.md, locked in this
// phase):
//
//   debug_id           "1234abcd-..." — LC_UUID of the binary the
//                      crashed PC belongs to. Mirrors what the dSYM
//                      upload (sub-A) keys on.
//   arch               "arm64" / "x86_64" / ... — atos arch family.
//   instructionAddress decimal or "0x..." hex — PC at crash time.
//   imageAddress       decimal or "0x..." hex — base address the
//                      binary was loaded at (ASLR slide). Subtract
//                      from instructionAddress to get the static
//                      offset DWARF tables key on.
//
// When all four are present we look up the dSYM bytea by
// (project_id, debug_id, arch), parse the Mach-O slice, build a
// gimli::Dwarf, and resolve the static offset to (function, file,
// line). Result is merged into the frame so the dashboard sees a
// symbolicated row.
//
// atos is macOS-only; we use pure-Rust addr2line + gimli + object
// so symbolication runs on the Linux production server. The
// resolver dumps the dSYM bytes to /tmp on first use (one file per
// (debug_id, arch)), then `Loader::new(path)` memory-maps it for
// each frame. /tmp on tmpfs keeps re-opens fast — Phase 22 sub-F
// adds a proper LRU mmap cache once we see real load.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use addr2line::Loader;
use object::macho::{MachHeader32, MachHeader64};
use object::read::macho::{FatArch, MachHeader, MachOFatFile32, MachOFatFile64};
use object::{Endianness, FileKind};
use sqlx::PgPool;
use uuid::Uuid;

const CACHE_MAX: usize = 200;

#[derive(Eq, Hash, PartialEq)]
struct CacheKey {
    arch: String,
    debug_id: String,
    project_id: Uuid,
}

/// Cached: (project_id, debug_id, arch) → on-disk path of the
/// extracted Mach-O slice. The path is in /tmp/sentori-dsyms; we
/// don't cache the Loader itself because its internal arenas hold
/// borrows we can't easily put behind an Arc. Re-opening the file
/// on each frame is cheap on tmpfs and lets us drop the resolver
/// state as soon as the crash payload is processed.
static PATH_CACHE: OnceLock<Mutex<HashMap<CacheKey, PathBuf>>> = OnceLock::new();

fn path_cache() -> &'static Mutex<HashMap<CacheKey, PathBuf>> {
    PATH_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn dsym_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("SENTORI_DSYM_CACHE_DIR")
            .unwrap_or_else(|_| "/tmp/sentori-dsyms".to_string()),
    )
}

/// Walk every frame on `payload.error.stack[]` (and recursively on
/// `.cause.stack[]`). Frames missing native fields are left alone.
/// All errors are swallowed — best-effort symbolication.
pub async fn symbolicate_payload(
    pool: &PgPool,
    project_id: Uuid,
    payload: &mut serde_json::Value,
) {
    if let Some(error) = payload.get_mut("error") {
        symbolicate_error_recursive(pool, project_id, error).await;
    }
}

async fn symbolicate_error_recursive(
    pool: &PgPool,
    project_id: Uuid,
    error: &mut serde_json::Value,
) {
    if let Some(serde_json::Value::Array(stack)) = error.get_mut("stack") {
        for frame in stack.iter_mut() {
            symbolicate_frame_inplace(pool, project_id, frame).await;
        }
    }
    if let Some(cause) = error.get_mut("cause") {
        if !cause.is_null() {
            // async fn recursion needs a known-size future via Box::pin.
            Box::pin(symbolicate_error_recursive(pool, project_id, cause)).await;
        }
    }
}

async fn symbolicate_frame_inplace(
    pool: &PgPool,
    project_id: Uuid,
    frame: &mut serde_json::Value,
) {
    let Some(debug_id) = frame.get("debugId").and_then(|v| v.as_str()).map(normalise) else {
        return;
    };
    let Some(arch) = frame.get("arch").and_then(|v| v.as_str()).map(str::to_string) else {
        return;
    };
    let Some(instr) = frame.get("instructionAddress").and_then(parse_addr) else {
        return;
    };
    let image = frame.get("imageAddress").and_then(parse_addr).unwrap_or(0);
    if instr < image {
        return;
    }
    let offset = instr - image;

    let path = match ensure_dumped(pool, project_id, &debug_id, &arch).await {
        Ok(Some(p)) => p,
        Ok(None) => return,
        Err(e) => {
            tracing::warn!(error = %e, %project_id, %debug_id, %arch, "ios symbolicate: dump failed");
            return;
        }
    };

    let loader = match Loader::new(&path) {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!(error = %e, ?path, "ios symbolicate: loader failed");
            return;
        }
    };

    let mut iter = match loader.find_frames(offset) {
        Ok(it) => it,
        Err(_) => return,
    };
    let mut last_function: Option<String> = None;
    let mut last_file: Option<String> = None;
    let mut last_line: Option<u32> = None;
    while let Ok(Some(f)) = iter.next() {
        if let Some(fname) = f
            .function
            .and_then(|fn_| fn_.demangle().ok().map(|s| s.into_owned()))
        {
            last_function = Some(fname);
        }
        if let Some(loc) = f.location {
            if let Some(file) = loc.file {
                last_file = Some(file.to_string());
            }
            if let Some(line) = loc.line {
                last_line = Some(line);
            }
        }
    }

    if let Some(fname) = last_function {
        frame["function"] = serde_json::Value::String(fname);
    }
    if let Some(file) = last_file {
        frame["file"] = serde_json::Value::String(file);
    }
    if let Some(line) = last_line {
        frame["line"] = serde_json::Value::from(line as u64);
    }
    frame["inApp"] = serde_json::Value::Bool(true);
}

async fn ensure_dumped(
    pool: &PgPool,
    project_id: Uuid,
    debug_id: &str,
    arch: &str,
) -> anyhow::Result<Option<PathBuf>> {
    let key = CacheKey {
        arch: arch.to_string(),
        debug_id: debug_id.to_string(),
        project_id,
    };
    if let Some(p) = path_cache().lock().unwrap().get(&key).cloned() {
        if p.exists() {
            return Ok(Some(p));
        }
    }

    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT data FROM dsyms \
         WHERE project_id = $1 AND debug_id = $2 AND arch = $3 \
         LIMIT 1",
    )
    .bind(project_id)
    .bind(debug_id)
    .bind(arch)
    .fetch_optional(pool)
    .await?;

    let bytes = match row {
        Some((b,)) => b,
        None => return Ok(None),
    };

    // CLI uploads single-arch slices, but accept fat blobs as a
    // safety net so a hand-uploaded universal binary also works.
    let slice = pick_slice(&bytes, arch)?;

    let dir = dsym_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{}-{}", debug_id, arch));
    tokio::fs::write(&path, slice).await?;

    let mut c = path_cache().lock().unwrap();
    if c.len() >= CACHE_MAX {
        c.clear();
    }
    c.insert(key, path.clone());
    Ok(Some(path))
}

fn pick_slice<'a>(bytes: &'a [u8], wanted_arch: &str) -> anyhow::Result<&'a [u8]> {
    match FileKind::parse(bytes)? {
        FileKind::MachO32 | FileKind::MachO64 => Ok(bytes),
        FileKind::MachOFat32 => {
            let fat = MachOFatFile32::parse(bytes)?;
            for a in fat.arches() {
                let slice = a.data(bytes)?;
                let header = MachHeader32::<Endianness>::parse(slice, 0)?;
                let endian = header.endian()?;
                if arch_name(header.cputype(endian), header.cpusubtype(endian)) == wanted_arch {
                    return Ok(slice);
                }
            }
            Err(anyhow::anyhow!("fat32 has no slice matching arch {wanted_arch}"))
        }
        FileKind::MachOFat64 => {
            let fat = MachOFatFile64::parse(bytes)?;
            for a in fat.arches() {
                let slice = a.data(bytes)?;
                let header = MachHeader64::<Endianness>::parse(slice, 0)?;
                let endian = header.endian()?;
                if arch_name(header.cputype(endian), header.cpusubtype(endian)) == wanted_arch {
                    return Ok(slice);
                }
            }
            Err(anyhow::anyhow!("fat64 has no slice matching arch {wanted_arch}"))
        }
        other => Err(anyhow::anyhow!("not a Mach-O file: {other:?}")),
    }
}

// Same mapping as cli/src/dsym.rs::arch_name; copied to avoid a
// crate-level dep cycle.
fn arch_name(cputype: u32, cpusubtype: u32) -> &'static str {
    use object::macho::{
        CPU_SUBTYPE_ARM64E, CPU_SUBTYPE_X86_64_H, CPU_TYPE_ARM, CPU_TYPE_ARM64,
        CPU_TYPE_ARM64_32, CPU_TYPE_X86, CPU_TYPE_X86_64,
    };
    let sub = cpusubtype & 0x00ff_ffff;
    match cputype {
        CPU_TYPE_ARM64 if sub == CPU_SUBTYPE_ARM64E => "arm64e",
        CPU_TYPE_ARM64 => "arm64",
        CPU_TYPE_ARM64_32 => "arm64_32",
        CPU_TYPE_ARM => match sub {
            6 => "armv6",
            9 => "armv7",
            11 => "armv7s",
            12 => "armv7k",
            _ => "arm",
        },
        CPU_TYPE_X86_64 if sub == CPU_SUBTYPE_X86_64_H => "x86_64h",
        CPU_TYPE_X86_64 => "x86_64",
        CPU_TYPE_X86 => "i386",
        _ => "unknown",
    }
}

fn parse_addr(v: &serde_json::Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    let s = v.as_str()?;
    let s = s.trim();
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).ok()
    } else {
        s.parse().ok()
    }
}

fn normalise(s: &str) -> String {
    let hex: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let h = hex.to_ascii_lowercase();
    if h.len() == 32 {
        format!(
            "{}-{}-{}-{}-{}",
            &h[0..8],
            &h[8..12],
            &h[12..16],
            &h[16..20],
            &h[20..32]
        )
    } else {
        s.to_ascii_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_addr_decimal_and_hex() {
        assert_eq!(parse_addr(&json!(4096u64)), Some(4096));
        assert_eq!(parse_addr(&json!("4096")), Some(4096));
        assert_eq!(parse_addr(&json!("0x1000")), Some(0x1000));
        assert_eq!(parse_addr(&json!("0X1abc")), Some(0x1abc));
        assert_eq!(parse_addr(&json!("not-a-number")), None);
    }

    #[test]
    fn normalise_debug_id_round_trips() {
        let canon = "1234abcd-1234-1234-1234-1234567890ab";
        assert_eq!(normalise(canon), canon);
        assert_eq!(normalise("1234ABCD-1234-1234-1234-1234567890AB"), canon);
        // Bare 32-hex (no dashes) should canonicalise the same.
        assert_eq!(normalise("1234abcd1234123412341234567890ab"), canon);
    }

    #[test]
    fn normalise_invalid_falls_back_to_lowercase() {
        // Wrong length — no canonical form, just lowercase.
        assert_eq!(normalise("ABC"), "abc");
    }
}
