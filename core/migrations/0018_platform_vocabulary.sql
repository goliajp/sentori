-- One platform vocabulary, and a place to put what we do not recognise.
--
-- v4 adds two runtimes (browser `web`, WeChat mini program `weapp`) to
-- the three the CHECK was written for. It also adds `unknown`: ingest
-- used to answer 400 for a platform it did not know, which turns an
-- SDK newer than its server into silent data loss — the batch endpoint
-- answers 200 and buries the refusal in a per-item outcome. Storing an
-- unrecognised value verbatim is worse still, because platform is part
-- of the issue fingerprint and one typo would split a case forever.
-- So an unrecognised platform lands on a fixed value and moves a
-- counter, and neither end fails.
--
-- `event_attachments.source` carried a third spelling of the same
-- idea (`js` where events say `javascript`). The rows are rewritten to
-- the events spelling; `js` stays acceptable on the wire, because
-- every SDK in the field posts it.

ALTER TABLE events DROP CONSTRAINT events_platform_check;
ALTER TABLE events ADD CONSTRAINT events_platform_check
  CHECK (platform IN ('javascript', 'ios', 'android', 'web', 'weapp', 'unknown'));

UPDATE event_attachments SET source = 'javascript' WHERE source = 'js';

ALTER TABLE event_attachments DROP CONSTRAINT event_attachments_source_check;
ALTER TABLE event_attachments ADD CONSTRAINT event_attachments_source_check
  CHECK (source IN ('javascript', 'ios', 'android', 'web', 'weapp', 'unknown'));
