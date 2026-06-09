-- v2.31 — topic pub-sub. Each device may subscribe to N topics; a
-- send addressed to `to: { topic: '<name>' }` fans out to every
-- subscribed device in the calling project.
--
-- Per-project — same topic name across projects is independent.

CREATE TABLE device_topics (
    device_token_id  UUID NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
    topic            TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (device_token_id, topic)
);

-- Index for fanout lookup: "give me every active token in project X
-- subscribed to topic Y".
CREATE INDEX device_topics_topic_idx
    ON device_topics (topic);
