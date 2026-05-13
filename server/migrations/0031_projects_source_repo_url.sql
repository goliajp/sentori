-- Phase 42 sub-A.11: per-project source repo URL.
--
-- Used by the dashboard's frame-row "Open on GitHub" link: when set,
-- a frame's `file` + `line` becomes a clickable link to the matching
-- blob on GitHub (or any other host that follows the
-- `<base>/blob/<ref>/<path>#L<line>` convention — GitLab, Bitbucket
-- Cloud, Gitea, etc.).
--
-- Stored verbatim (no scheme normalization). The dashboard appends
-- `/blob/<ref>/<file>#L<line>` so the value should be the repo root
-- like `https://github.com/goliajp/sentori`. NULL keeps the link
-- hidden.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_repo_url TEXT;
