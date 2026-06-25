-- Zendesk users cache — id → name/email/photo for support comment authors.
--
-- Why: the /support chat thread resolves each comment's author_id to a name+email.
-- Hitting the Zendesk users API at render time flickers ("User #2526" → email after a
-- second request) and hammers the API on every refresh. This table caches the roster
-- so the comments route can attach author identity server-side (resolved on first paint)
-- and only the Zendesk API misses fall through to a live fetch.
--
-- Org-scoped (a Zendesk user id is only meaningful within that tenant's Zendesk account);
-- one row per (org, zendesk_user_id), refreshed in place via ON CONFLICT.
--
-- Tenant-from-birth: organization_id NOT NULL defaulted from the app.current_org GUC so
-- writes under withTenantTransaction auto-stamp; per-org uniqueness.

BEGIN;

CREATE TABLE IF NOT EXISTS zendesk_users (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  zendesk_user_id  BIGINT NOT NULL,
  name             TEXT,
  email            TEXT,
  photo_url        TEXT,
  role             TEXT,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, zendesk_user_id)
);

COMMIT;
