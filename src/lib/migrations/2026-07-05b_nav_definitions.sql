-- ============================================================================
-- 2026-07-05b: nav_definitions (operator-surfaces refactor Phase 4 — nav as data)
-- ============================================================================
-- Per-org override for the sidebar/master navigation. The static APP_SIDEBAR_NAV
-- (src/lib/sidebar-navigation.ts) is the CODE default; one active row here is the
-- DATA override that can hide / rename / reorder existing nav items so a
-- business's sidebar reflects its operation — published without a deploy.
--
-- config jsonb shape (src/lib/nav/org-nav.ts NavDefinition):
--   { "entries": [ { "id": "<nav item id>", "hidden"?: bool, "label"?: text, "order"?: number } ] }
-- An override can only REFERENCE existing nav-item ids; it never introduces a
-- surface the code doesn't already define (mergeOrgNav enforces this), and a
-- null/absent row yields the static defaults unchanged — the safe default.
--
-- Versioning + is_active copy station_definitions / workflow_definitions: only
-- one active row per org; publishing a new version flips the flag.
--
-- Tenant-from-birth: organization_id auto-stamps from the app.current_org GUC
-- (mirrors station_definitions), and enforce_tenant_isolation installs FORCE RLS
-- + the canonical tenant_isolation policy in this same migration.
--
-- Readers/writers: GET/PUT /api/nav, loader src/lib/nav/load-org-nav.ts.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS nav_definitions (
  id               SERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  config           JSONB NOT NULL DEFAULT '{"entries":[]}'::jsonb,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_nav_definitions_org_version
  ON nav_definitions (organization_id, version);

-- At most one active nav definition per org.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nav_definitions_org_active
  ON nav_definitions (organization_id) WHERE is_active;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('nav_definitions');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — nav_definitions left without FORCE RLS';
  END IF;
END $$;

COMMIT;
