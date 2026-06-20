-- v1.3 W12/W13 — backfill the mode/deployment discriminator on
-- existing integration rows.
--
-- v1.2 stored GitHub configs as `{accessToken, defaultRepo}` and
-- Jira configs as `{email, apiToken, site, ...}`. v1.3 introduces
-- enum-shaped configs (`GithubConfig::Pat` / `GithubConfig::App`,
-- `JiraConfig::Cloud` / `JiraConfig::Server`) so the adapter can
-- branch on the discriminator.
--
-- Existing rows are by definition in the v1.2 shape — that
-- corresponds to PAT for GitHub and Cloud for Jira. Inject the
-- missing discriminator key so server-side deserialise into the
-- enum still works on those rows.

UPDATE integrations
SET    config = jsonb_set(config, '{mode}', '"pat"')
WHERE  kind = 'github'
  AND  NOT (config ? 'mode');

UPDATE integrations
SET    config = jsonb_set(config, '{deployment}', '"cloud"')
WHERE  kind = 'jira'
  AND  NOT (config ? 'deployment');
