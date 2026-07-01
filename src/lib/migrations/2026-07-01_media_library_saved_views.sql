-- Server-backed saved views for the Media Library (/ops/photos). One row per
-- named filter/view preset, owned by a staff member within an org. Applying a
-- view just rewrites the URL params (via usePhotoLibraryUrlState); this table
-- only persists the named snapshot so it survives reloads and syncs across a
-- user's devices. Mirrors 2026-06-24_operations_saved_views.sql exactly.
--
-- Tenant-scoped from birth: organization_id NOT NULL, enforced via the
-- enforce_tenant_isolation() helper (2026-06-14_rls_enforcement_infra.sql) so the
-- loud-fail DEFAULT + FORCE RLS + canonical tenant_isolation policy land in one
-- shot. Safe because the only writer (photos/saved-views routes) runs inside
-- withTenantTransaction (sets app.current_org) AND stamps organization_id
-- explicitly. Mirrors the staff_preferences precedent (raw SQL, not Drizzle).

CREATE TABLE IF NOT EXISTS media_library_saved_views (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  -- The full media-library snapshot:
  --   { schemaVersion, filters: PhotoLibraryFilterState, view: PhotoLibraryViewMode }
  -- One JSONB bag so adding a new filter never needs a column or a migration.
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Visible to the whole org (true) vs private to the creator (false, default).
  is_shared       BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_library_saved_views_name_chk CHECK (length(btrim(name)) > 0),
  -- One view name per staff per org (the ownership boundary is staff_id).
  CONSTRAINT media_library_saved_views_org_staff_name_uniq UNIQUE (organization_id, staff_id, name)
);

CREATE INDEX IF NOT EXISTS idx_media_library_saved_views_org_staff
  ON media_library_saved_views (organization_id, staff_id, sort_order);
-- Org-wide shared-view lookup.
CREATE INDEX IF NOT EXISTS idx_media_library_saved_views_org_shared
  ON media_library_saved_views (organization_id) WHERE is_shared = true;

-- Flip on FORCE RLS + loud-fail org default + canonical policy, if the
-- enforcement infra is present (it is, post-2026-06-14). Guarded so a fresh DB
-- without the helper still gets the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('media_library_saved_views');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — media_library_saved_views left without FORCE RLS';
  END IF;
END $$;
