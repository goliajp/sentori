-- v1.4 W23 — cross-org integration sharing / templating.
--
-- The operator typically administers multiple orgs (their personal
-- one + several customer/team orgs). Configuring "GitHub App" or
-- "Jira Cloud OAuth" once and then re-applying that configuration
-- to other orgs is a basic productivity move that v1.3 couldn't do
-- — there was no template surface at all, you had to re-run the
-- OAuth handshake or copy-paste PATs by hand for every org.
--
-- Schema design:
--   - `integration_templates` is keyed on the owner-user (not the
--     org). The operator's templates follow them across orgs;
--     transferring orgs doesn't strand their template library.
--   - `shared_with_org_id` (nullable) lets the owner mark a
--     template "visible to my org admins" so a teammate doesn't
--     have to redo the handshake. NULL = private to the owner.
--   - `config` is the same opaque JSONB shape adapter-config code
--     produces, minus any per-org bits the apply step will rewrite.
--     The adapter's `configure_from_json` step does the same shape
--     validation it does on first-time configuration, so no schema
--     enforcement lives at the DB layer.
--
-- The "apply template" action lives in the backend handler — it
-- POSTs the stored config to the existing per-org configure
-- endpoint, which means an apply can fail the same way an initial
-- configure can (e.g. token expired). No coupling between this
-- table and the per-org `integrations` rows; deleting a template
-- doesn't affect any applied instance.

CREATE TABLE IF NOT EXISTS integration_templates (
    id                  UUID PRIMARY KEY,
    owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL,
    name                TEXT NOT NULL,
    config              JSONB NOT NULL DEFAULT '{}'::JSONB,
    shared_with_org_id  UUID REFERENCES orgs(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_templates_owner_idx
    ON integration_templates (owner_user_id);

CREATE INDEX IF NOT EXISTS integration_templates_shared_org_idx
    ON integration_templates (shared_with_org_id)
    WHERE shared_with_org_id IS NOT NULL;

-- Per-owner uniqueness on (kind, name) so the operator can't end up
-- with two "GitHub-prod" templates of the same kind. Different kinds
-- with the same display name are still allowed (e.g. "main" for
-- GitHub vs Jira) because that's how the operator naturally talks
-- about them.
CREATE UNIQUE INDEX IF NOT EXISTS integration_templates_owner_kind_name_uniq
    ON integration_templates (owner_user_id, kind, name);
