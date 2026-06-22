-- Per-staff UI preferences — a single generic key/value JSONB bag, one row per
-- (org, staff). First consumer: the configurable focus-scan hotkey shared by
-- every StationScanBar across the app (default "F2"). Deliberately generic so
-- the next personal UI preference reuses this table instead of adding a column
-- or a bespoke table — mirror the staff_todos precedent (raw SQL, not Drizzle).
--
-- Tenant-scoped from birth: organization_id NOT NULL, enforced via the
-- enforce_tenant_isolation() helper (2026-06-14_rls_enforcement_infra.sql) so
-- the loud-fail DEFAULT + FORCE RLS + canonical tenant_isolation policy land in
-- one shot. Safe because the only writer (staff-preferences-queries) runs inside
-- withTenantConnection (sets app.current_org) AND stamps organization_id
-- explicitly. RLS stays inert until the app connects as the non-BYPASSRLS
-- app_tenant role (Phase E1); the loud-fail default is the immediate backstop.

CREATE TABLE IF NOT EXISTS staff_preferences (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  -- One JSONB bag of typed UI prefs, e.g. { "focusScanHotkey": "F2" }.
  prefs           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One prefs row per staff per org.
  CONSTRAINT staff_preferences_org_staff_unique UNIQUE (organization_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_preferences_org_staff
  ON staff_preferences (organization_id, staff_id);

-- Flip on FORCE RLS + loud-fail org default + canonical policy, if the
-- enforcement infra is present in this DB (it is, post-2026-06-14). Guarded so
-- a fresh DB without the helper still gets the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation'
  ) THEN
    PERFORM enforce_tenant_isolation('staff_preferences');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — staff_preferences left without FORCE RLS';
  END IF;
END $$;
