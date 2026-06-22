---
name: Feature request
about: Propose a new capability for Sentori.
title: '[feat] '
labels: enhancement
assignees: ''
---

## Problem

(What user-visible problem does this solve? Whose
problem is it?)

## Proposed shape

(How would it work from the user's side? Concrete
example calls / UI mock are better than abstract
description.)

## Cement-stone tier

Where would this live?
- [ ] New 石头 (pure utility) — `core/crates/<name>`
- [ ] New 钢筋 (business-aware) — `core/crates/<name>`
- [ ] Cement (composition) — `self-hosted/server` /
      `saas/server`
- [ ] Out of scope / belongs in the SaaS-only repo

## Alternatives considered

(What did you reject + why? Helps reviewers not re-tread
your reasoning.)

## Compat impact

- Does it change any `/v1/*` SDK ingest shape? (If yes,
  describe deprecation window per
  `docs-v0.1/reference/api-compat.md`.)
- Does it require a DB migration? (If yes, append-only
  forward-compatible only — no destructive changes.)
- Does it raise the minimum Rust version?

## Willing to contribute?

- [ ] I'd like to write the PR myself.
- [ ] I can co-design but not implement.
- [ ] Reporting only.
