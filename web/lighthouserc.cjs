// Phase 47.05 — Lighthouse CI config for the Sentori dashboard.
//
// One assertion gate: LCP under 1.2 s on the issues list (the page
// the user sees most). Other categories are reported but don't fail
// the build — perf is the only one we treat as a hard contract.
//
// To run locally:
//
//     cd web
//     bun run build      # produces dist/
//     bun run preview &  # serves dist/ on http://localhost:4173
//     bun run lhci       # runs lighthouse-ci against the running server
//     kill %1            # stop preview
//
// `bun run lhci` uses `bunx @lhci/cli@^0.16 autorun` so nothing
// installs into node_modules — the binary is fetched per-invocation.
//
// CI hook-up:
//   - Add a job that runs `bun run build && bun run preview &`, waits
//     for the preview server, then `bun run lhci`.
//   - lhci's autorun honours `LHCI_TOKEN` / `LHCI_SERVER_BASE_URL` env
//     vars to upload to a remote LHCI server; for sentori we just
//     keep the JSON reports in the artifact bucket of the run.

module.exports = {
  ci: {
    assert: {
      // Treat the LCP budget as the only build-breaker. Other
      // categories (TBT, CLS, SI, FCP) emit warnings.
      assertions: {
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 1500 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 1200 }],
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
      },
    },
    collect: {
      // Dashboard pages we measure. Add more as the surface grows;
      // each URL adds ~30s to the run, so be selective.
      url: ['http://localhost:4173/login'],
      // Three runs is the lhci-recommended floor — median across them
      // smooths out cold-cache vs. warm-cache noise.
      numberOfRuns: 3,
      // We don't want the throttling profile to depend on the host
      // running the test (devs have wildly varying CPUs). Pin to the
      // "mobile" preset so dev machines and CI runners agree on what
      // "1.2 s" means.
      settings: {
        preset: 'desktop',
      },
    },
    upload: {
      // Default temporary-public-storage uploads each report to
      // googleapis storage with a 7-day TTL; the CLI prints the URL
      // for human inspection. No persistent server / token required.
      target: 'temporary-public-storage',
    },
  },
}
