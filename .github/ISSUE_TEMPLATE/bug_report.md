---
name: Bug report
about: Something broke. Help us reproduce.
title: '[bug] '
labels: bug
assignees: ''
---

## What happened?

(One sentence — the observed behaviour.)

## What did you expect?

(One sentence — the expected behaviour.)

## Minimal repro

```
# commands / config that triggers the issue
```

## Environment

- Sentori version: (image tag / `git log -1 --oneline`)
- Deploy mode: docker-compose / Helm / cargo run
- OS + arch: (e.g. linux/amd64, macOS arm64)
- Postgres version: 18.x

## Logs

```
# `docker logs sentori-server | tail -50` or equivalent
```

## Additional context

(Anything else — screenshots, related issues, your guess
at root cause.)
