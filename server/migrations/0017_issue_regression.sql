-- Phase 23 sub-D: regression detection.
--
-- An issue can be marked `resolved` (人工 / 自动 fix-deploy 后)。一旦
-- 之后再有 event 落进同一 fingerprint，状态自动切到 `regressed` 并记录
-- 触发时间 + 触发 release 字符串。`regressed` 是终态，需要再次 patch
-- 才能回 `active` / `resolved`。
--
-- release 不上 FK：releases 表本身是 sparse 的（只在 sourcemap / dSYM /
-- deploy 写入时才 upsert），强行 FK 会让 ingest 路径多一次 lookup +
-- 写入。和 `issues.last_release` 一致用 TEXT。

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_check;
ALTER TABLE issues
  ADD CONSTRAINT issues_status_check
  CHECK (status IN ('active', 'silenced', 'closed', 'resolved', 'regressed'));

ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at          TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_in_release  TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS regressed_at         TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS regressed_in_release TEXT;

-- cron 兜底扫描走这个部分索引：理论上 on-event 路径已经在 upsert 里把
-- resolved → regressed 切完，这里只兜真没切到的（DB write race / 老
-- 数据）。
CREATE INDEX IF NOT EXISTS issues_resolved_idx
  ON issues (project_id) WHERE status = 'resolved';
