-- ============================================================================
-- 2026-05-22_organizations_tenancy.sql
--
-- Foundation for multi-tenancy. This migration only introduces the tenant
-- entity and attaches staff/sessions to it — it does NOT yet add
-- organization_id to every business table (that's the next migration, gated
-- by an ESLint/code-review rule that no new queries land without scoping).
--
-- USAV is created as organization #1 with a fixed UUID so existing code
-- paths that hard-coded the deployment can be migrated incrementally.
--
-- Backwards-compatible: every existing staff row is backfilled to the USAV
-- org. The `organization_id` column on staff is NOT NULL after backfill so
-- the next code change (auth context) can assume it.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto on older Postgres; safe no-op on newer.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tenant root ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE,
  name                text NOT NULL,
  plan                text NOT NULL DEFAULT 'trial',
  status              text NOT NULL DEFAULT 'active', -- active | suspended | deleted
  -- Stripe linkage lands here when billing module ships. Nullable until then.
  stripe_customer_id  text,
  stripe_subscription_id text,
  -- Open-ended bag for non-relational tenant config: branding, timezone,
  -- currency, label format, business hours, etc. Schema policed at the
  -- application layer (zod) so we can iterate without DDL churn.
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  trial_ends_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_organizations_plan   ON organizations (plan);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer
  ON organizations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ─── Bootstrap USAV as org #1 ──────────────────────────────────────────────
-- Fixed UUID so transitional code paths can reference it as a constant.
-- Lives in src/lib/tenancy/constants.ts.
INSERT INTO organizations (id, slug, name, plan, status, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'usav',
  'USAV Solutions',
  'enterprise',
  'active',
  '{"timezone":"America/Los_Angeles","currency":"USD","brand":{"name":"USAV"}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ─── Attach staff to a tenant ──────────────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES organizations(id) ON DELETE RESTRICT;

UPDATE staff
   SET organization_id = '00000000-0000-0000-0000-000000000001'
 WHERE organization_id IS NULL;

ALTER TABLE staff
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_organization ON staff (organization_id);

-- ─── Sessions remember which tenant the staff signed into ──────────────────
-- A future feature is "user belongs to N orgs"; staff_sessions.organization_id
-- captures which one is the active context for this session. For now it
-- always equals staff.organization_id, but separating it lets us add the
-- org-switcher without a second migration.
ALTER TABLE staff_sessions
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE staff_sessions s
   SET organization_id = st.organization_id
  FROM staff st
 WHERE s.staff_id = st.id
   AND s.organization_id IS NULL;

ALTER TABLE staff_sessions
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_sessions_organization
  ON staff_sessions (organization_id);

-- ─── updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_touch_updated_at ON organizations;
CREATE TRIGGER organizations_touch_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
