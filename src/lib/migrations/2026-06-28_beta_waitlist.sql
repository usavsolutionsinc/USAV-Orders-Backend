-- ============================================================================
-- 2026-06-28: beta_waitlist — lightweight pre-tenant beta signup capture
-- ============================================================================
-- Email-capture + video-preview-interest waitlist for the public marketing
-- site (CycleForge). Powers the marketing funnel and the data-driven "spots
-- remaining" counter (see /api/beta/spots, /api/beta/waitlist).
--
-- INTENTIONALLY GLOBAL / ORG-LESS — DO NOT ADD organization_id OR RLS.
-- These rows are created BEFORE any organization exists (a visitor signs up on
-- the marketing site before they are ever a tenant). There is no org to scope
-- to, so this table is global by design: it carries NO organization_id, needs
-- NO enforce_tenant_isolation() / FORCE RLS, and the tenancy guard should treat
-- it as an intentionally-global pre-tenant table (like other pre-auth funnel
-- tables, e.g. beta_applications). Conversion to a real org happens later via
-- the normal /api/auth/signup flow.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS beta_waitlist;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS beta_waitlist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  company_name TEXT,
  source       TEXT,
  utm          JSONB NOT NULL DEFAULT '{}'::jsonb,
  wants_video  BOOLEAN NOT NULL DEFAULT false,
  status       TEXT NOT NULL DEFAULT 'waitlist',  -- waitlist | invited | converted
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Status domain.
DO $$ BEGIN
  ALTER TABLE beta_waitlist
    ADD CONSTRAINT beta_waitlist_status_chk
    CHECK (status IN ('waitlist', 'invited', 'converted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per email (case-insensitive); the upsert in /api/beta/waitlist
-- targets this index via ON CONFLICT (lower(email)).
CREATE UNIQUE INDEX IF NOT EXISTS ux_beta_waitlist_lower_email
  ON beta_waitlist (lower(email));

-- "spots remaining" reads count where status in ('invited','converted').
CREATE INDEX IF NOT EXISTS idx_beta_waitlist_status
  ON beta_waitlist (status);

COMMENT ON TABLE beta_waitlist IS
  'Pre-tenant public beta waitlist (email + video interest). INTENTIONALLY GLOBAL: no organization_id, no RLS — rows exist before any org. Powers the spots-remaining counter.';

COMMIT;
