// Enforce the root `VERSION` file as the single source of truth for the
// user-visible Sentori version string. server/Cargo.toml `version` and
// web/package.json `version` and the root `VERSION` file all must match;
// drift is the bug class that produced the 2026-05-22 incident (server
// held rc.1 while dashboard displayed v1.1.0). This build script makes
// drift a hard build failure.
//
// web/vite.config.ts performs the symmetrical check at dashboard build
// time. See docs/roadmap/v2.20.md WU W2.

use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set"));
    // Phase A.1 — crate 现在在 server/crates/core/, 跳 3 层 (../../..)
    // 到 repo root.
    let version_path = manifest_dir
        .join("..")
        .join("..")
        .join("..")
        .join("VERSION");
    println!("cargo:rerun-if-changed={}", version_path.display());

    let root_version = fs::read_to_string(&version_path)
        .unwrap_or_else(|e| panic!("cannot read root VERSION file at {version_path:?}: {e}"))
        .trim()
        .to_string();
    let cargo_version = std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION not set");

    if root_version != cargo_version {
        panic!(
            "version drift: server/Cargo.toml = {cargo_version}, root VERSION = {root_version}. \
             Update both to match (and web/package.json too — vite enforces it).",
        );
    }
}
