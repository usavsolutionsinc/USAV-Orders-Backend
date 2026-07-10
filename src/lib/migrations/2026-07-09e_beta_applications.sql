-- ============================================================================
-- 2026-07-09e: beta_applications — $50 refundable beta application pipeline
-- ============================================================================
-- The paid tier of the beta intake funnel (docs/todo/beta-intake-funnel-plan.md
-- §5, P-1a). Captures ontology-keyed application answers from the public
-- marketing site (CycleForge) via POST /api/beta/apply, and doubles as the
-- pipeline tracker (status column) — no separate CRM.
--
-- INTENTIONALLY GLOBAL / ORG-LESS — DO NOT ADD organization_id OR RLS.
-- Mirrors beta_waitlist's ratified posture exactly (2026-06-28_beta_waitlist.sql
-- header + docs/tenancy/needs-col-classification.md "platform-identity
-- (pre-tenant)" exemption list, where beta_applications was already named as
-- the sibling example). These rows are created BEFORE any organization exists —
-- a visitor applies on the marketing site before they are ever a tenant, so
-- there is no org to scope to: NO organization_id, NO enforce_tenant_isolation()
-- / FORCE RLS. Conversion to a real org happens later via the normal signup
-- flow (a future converted_org_id column will link forward when tenant
-- onboarding exists). Registered in scripts/tenancy-coverage.mjs
-- PLATFORM_IDENTITY in the same change.
--
-- Status vocabulary (pipeline, manual review — plan §2/§6):
--   RECEIVED      application submitted (payment may still be pending;
--                 v1 Stripe reconcile is manual, plan §7)
--   UNDER_REVIEW  a human is building the floor map / reviewing fit
--   ACCEPTED      approval email sent — deliverable + cohort spot
--   REFUNDED      $50 returned (valid exit from any state, no questions)
--   REJECTED      not a fit — refunded + waitlisted (rare)
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS beta_applications;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS beta_applications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  company_name TEXT,
  -- 'waitlist' rows arrive via the same apply endpoint (plan §9 wires the
  -- marketing waitlist form to tier: 'waitlist'); 'application' is the $50 tier.
  tier         TEXT NOT NULL DEFAULT 'application',
  -- Keyed by the ontology question ids (plan §4) so answers aggregate
  -- structurally across companies; validated app-side by the Zod schema in
  -- src/lib/beta/apply-schema.ts (the writing route is the enforcement point).
  answers      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'RECEIVED',
  -- Stripe Payment Link client_reference_id / checkout session id (manual
  -- reconcile in v1 — no payments code, plan §7).
  stripe_ref   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tier domain.
DO $$ BEGIN
  ALTER TABLE beta_applications
    ADD CONSTRAINT beta_applications_tier_chk
    CHECK (tier IN ('waitlist', 'application'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Status domain.
DO $$ BEGIN
  ALTER TABLE beta_applications
    ADD CONSTRAINT beta_applications_status_chk
    CHECK (status IN ('RECEIVED', 'UNDER_REVIEW', 'ACCEPTED', 'REFUNDED', 'REJECTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per email (case-insensitive); the upsert in /api/beta/apply targets
-- this index via ON CONFLICT (lower(email)) — a re-apply is an idempotent
-- refresh, never a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_beta_applications_lower_email
  ON beta_applications (lower(email));

-- Review-queue reads filter by status (admin GET /api/beta/applications).
CREATE INDEX IF NOT EXISTS idx_beta_applications_status
  ON beta_applications (status);

COMMENT ON TABLE beta_applications IS
  'Pre-tenant $50 refundable beta application pipeline (ontology answers + pipeline status). INTENTIONALLY GLOBAL: no organization_id, no RLS — rows exist before any org (same ratified posture as beta_waitlist).';

COMMIT;
