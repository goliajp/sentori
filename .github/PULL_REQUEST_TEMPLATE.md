<!--
Phase 33 sub-E. Checklist for the reviewer (and the author —
self-check before requesting review):
-->

## Summary

<!-- 1–3 bullets describing what changed and why. -->

## Reviewer checklist

- [ ] **Performance**: if this PR touches any SQL query, ingest
      endpoint, or dashboard hot path, did you re-run the baselines
      in [`docs/performance.md`](../docs/performance.md)? Any number
      regressing > 20 % needs an explanation in this PR or a
      follow-up commit. Plan-shape changes (new Seq Scan / Sort /
      Hash Join / partition pruning loss) are tight: explain or
      revert.
- [ ] **Tests**: new behaviour has a test. `cargo test --lib`
      (server) and `bun run --filter '@goliapkg/sentori-*' test`
      (SDKs) both pass locally.
- [ ] **Docs**: if you added a new SDK surface or changed wire
      protocol, the matching `docs-site/` page and `docs/`
      mirror are updated.
- [ ] **Migrations**: if you added a `server/migrations/NNNN_*.sql`,
      it runs forward cleanly and there's a known-safe rollback
      (or "rollback not supported" stated explicitly).

## Test plan

<!--
Bulleted markdown checklist of what you tested manually:
- [ ] dashboard build
- [ ] vite dev smoke
- [ ] e2e (if applicable)
- ...
-->
