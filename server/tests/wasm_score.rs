// v1.1 audit-closeout C — regression test for the WASM trust-score
// kernel at `wasm/score/`.
//
// The 433-byte artifact is built once per release of the standalone
// `sentori-score` Cargo package and committed to
// `web/public/wasm/sentori_score.wasm` so dashboards (and CI without
// a wasm toolchain) can serve it directly. This test loads it via
// `wasmtime` and verifies the math kernel:
//   - `score(0)` on a zeroed buffer returns the baseline (100)
//   - `set_pair` + `score` produces the same result the server's
//     Rust kernel would (100 - sum(weight*count), clamped)
//   - `reset` zeroes the buffer
//   - `max_kinds` matches the declared MAX_KINDS = 64 in the crate
//
// If a future toolchain bump silently changes wasm calling
// conventions or the kernel's panic_handler behaviour the test
// breaks loudly here, before the dashboard slider silently misreads.

use std::path::PathBuf;
use wasmtime::{Engine, Instance, Module, Store, TypedFunc};

fn wasm_path() -> PathBuf {
    let manifest = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest)
        .parent()
        .unwrap()
        .join("web/public/wasm/sentori_score.wasm")
}

struct Kernel {
    store: Store<()>,
    set_pair: TypedFunc<(i32, i32, i32), ()>,
    score: TypedFunc<i32, i32>,
    reset: TypedFunc<(), ()>,
    max_kinds: TypedFunc<(), i32>,
}

fn load_kernel() -> Kernel {
    let engine = Engine::default();
    let bytes = std::fs::read(wasm_path()).expect("wasm artifact must exist; rebuild wasm/score");
    let module = Module::from_binary(&engine, &bytes).expect("module decodes");
    let mut store: Store<()> = Store::new(&engine, ());
    let instance = Instance::new(&mut store, &module, &[]).expect("instantiates");
    let set_pair = instance
        .get_typed_func::<(i32, i32, i32), ()>(&mut store, "set_pair")
        .expect("set_pair export");
    let score = instance
        .get_typed_func::<i32, i32>(&mut store, "score")
        .expect("score export");
    let reset = instance
        .get_typed_func::<(), ()>(&mut store, "reset")
        .expect("reset export");
    let max_kinds = instance
        .get_typed_func::<(), i32>(&mut store, "max_kinds")
        .expect("max_kinds export");
    Kernel {
        store,
        set_pair,
        score,
        reset,
        max_kinds,
    }
}

#[test]
fn wasm_score_baseline_with_zero_pairs() {
    let mut k = load_kernel();
    k.reset.call(&mut k.store, ()).unwrap();
    let s = k.score.call(&mut k.store, 0).unwrap();
    assert_eq!(s, 100, "score(len=0) is baseline");
}

#[test]
fn wasm_score_matches_server_kernel() {
    let mut k = load_kernel();
    k.reset.call(&mut k.store, ()).unwrap();
    // pin.mismatch (weight 30) × 1 + root.detected (weight 50) × 1
    // = penalty 80 → score 20. Mirrors the trust_score proptest +
    // the server-side `score_from_counts` kernel.
    k.set_pair.call(&mut k.store, (0, 30, 1)).unwrap();
    k.set_pair.call(&mut k.store, (1, 50, 1)).unwrap();
    let s = k.score.call(&mut k.store, 2).unwrap();
    assert_eq!(s, 20);
}

#[test]
fn wasm_score_clamped_to_zero_under_heavy_penalty() {
    let mut k = load_kernel();
    k.reset.call(&mut k.store, ()).unwrap();
    // 5 × root.detected (50 each) = 250 → would underflow → clamp 0.
    k.set_pair.call(&mut k.store, (0, 50, 5)).unwrap();
    let s = k.score.call(&mut k.store, 1).unwrap();
    assert_eq!(s, 0, "score floored at 0");
}

#[test]
fn wasm_reset_zeroes_buffer() {
    let mut k = load_kernel();
    k.set_pair.call(&mut k.store, (0, 50, 1)).unwrap();
    k.reset.call(&mut k.store, ()).unwrap();
    let s = k.score.call(&mut k.store, 1).unwrap();
    assert_eq!(s, 100, "after reset the buffer reads as zero penalty");
}

#[test]
fn wasm_max_kinds_matches_crate_constant() {
    let mut k = load_kernel();
    let n = k.max_kinds.call(&mut k.store, ()).unwrap();
    assert_eq!(n, 64, "MAX_KINDS in wasm/score/src/lib.rs must stay 64");
}
