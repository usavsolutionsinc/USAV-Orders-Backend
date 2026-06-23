-- ============================================================================
-- 2026-06-23: photo_folders + photo_folder_items — persistent "master folders"
-- ============================================================================
-- The photo library's existing folders are DERIVED at render time (photos
-- grouped by po_ref / linked Zendesk ticket). This adds operator-created,
-- org-scoped folders with full CRUD (create / rename / reorder / nest via
-- parent_id) plus a join table that assigns any photo (photos.id) into a folder
-- — a manual organizational overlay on top of the derived grouping. Phase 2 of
-- the photo-library folder redesign.
--
-- Tenant-from-birth: organization_id UUID NOT NULL, enforced via
-- enforce_tenant_isolation() (2026-06-14_rls_enforcement_infra.sql) so the
-- loud-fail org DEFAULT + FORCE RLS + canonical tenant_isolation policy land in
-- one shot. Safe to enforce now: the only writers (src/lib/photos/folders.ts,
-- reached through the /api/photos/folders routes) run inside
-- withTenantTransaction (SET LOCAL app.current_org) AND pass organization_id
-- explicitly on every INSERT. RLS is inert under neondb_owner (BYPASSRLS) until
-- the app connects as the app_tenant role; the loud-fail DEFAULT is the
-- immediate backstop.
--
-- ROLLBACK:
--   select relax_tenant_isolation('photo_folder_items');
--   select relax_tenant_isolation('photo_folders');
--   DROP TABLE IF EXISTS photo_folder_items;
--   DROP TABLE IF EXISTS photo_folders;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS photo_folders (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,                 -- no DEFAULT; helper installs the loud-fail GUC default
  parent_id       BIGINT REFERENCES photo_folders(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sort_index      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-org, per-parent, case-insensitive name uniqueness. COALESCE folds the
-- NULL (root) parent to 0 so two root folders can't share a name either — a
-- plain UNIQUE(organization_id, parent_id, name) would treat NULL parents as
-- distinct and allow duplicate root names.
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_folders_org_parent_name
  ON photo_folders (organization_id, COALESCE(parent_id, 0), lower(name));

CREATE INDEX IF NOT EXISTS idx_photo_folders_org_parent_sort
  ON photo_folders (organization_id, COALESCE(parent_id, 0), sort_index, id);

COMMENT ON TABLE photo_folders IS
  'Operator-created photo library folders (org-scoped, nestable via parent_id). Manual overlay on the derived po_ref/ticket grouping. Phase 2 of the photo-library folder redesign.';

CREATE TABLE IF NOT EXISTS photo_folder_items (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  folder_id       BIGINT NOT NULL REFERENCES photo_folders(id) ON DELETE CASCADE,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_photo_folder_items UNIQUE (organization_id, folder_id, photo_id)
);

-- Reverse lookup ("which folders is this photo in") + the library folder filter.
CREATE INDEX IF NOT EXISTS idx_photo_folder_items_org_photo
  ON photo_folder_items (organization_id, photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_folder_items_folder
  ON photo_folder_items (organization_id, folder_id);

COMMENT ON TABLE photo_folder_items IS
  'Assignment join: a photo (photos.id) placed into a photo_folders folder. UNIQUE(org, folder, photo) makes re-adds idempotent.';

-- Flip on FORCE RLS + loud-fail org default + canonical policy when the
-- enforcement infra is present (guarded so a fresh DB without it still gets the
-- tables). Writers already stamp organization_id under the GUC (see header).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('photo_folders');
    PERFORM enforce_tenant_isolation('photo_folder_items');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — photo_folders/items left without FORCE RLS';
  END IF;
END $$;

COMMIT;
