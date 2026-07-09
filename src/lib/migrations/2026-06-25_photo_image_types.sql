-- ============================================================================
-- 2026-06-25: photo_image_types — org-scoped image-type registry (+ GCS prefix)
-- ============================================================================
-- The photo library's sidebar is organized by "image type" (the source scope:
-- unboxing / local_pickup / packing / repair / claims). Those five are BUILT-IN
-- and stay defined in code (derived from a photo's entity type at query time —
-- see lib/photos/image-types.ts). This table holds the operator-added CUSTOM
-- image types: each carries a `gcs_prefix` so its photos land under a distinct
-- bucket path ({org}/{gcs_prefix}/{yyyy}/{mm}/…) and a `key` matched against
-- photos.photo_type at upload + query time (no new column on the hot photos
-- table — reuse the existing photo_type tag).
--
-- This supersedes the saved-folder system (2026-06-23_photo_folders.sql +
-- 2026-06-25_photo_folder_source_scope.sql): the photo-library folder UI was
-- removed (date "folders" are now derived from created_at), so photo_folders /
-- photo_folder_items are dropped here. They held no load-bearing data beyond a
-- manual organizational overlay that no longer has a surface.
--
-- Tenant-from-birth: organization_id UUID NOT NULL, enforced via
-- enforce_tenant_isolation() so the loud-fail org DEFAULT + FORCE RLS + canonical
-- tenant_isolation policy land in one shot. The only writer (lib/photos/
-- image-types.ts via /api/photos/image-types) runs inside withTenantTransaction
-- (SET LOCAL app.current_org) AND passes organization_id explicitly on INSERT.
--
-- ROLLBACK:
--   select relax_tenant_isolation('photo_image_types');
--   DROP TABLE IF EXISTS photo_image_types;
--   -- (photo_folders / photo_folder_items are not recreated by rollback)
-- ============================================================================

BEGIN;

-- ── Drop the superseded saved-folder tables ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'relax_tenant_isolation') THEN
    IF to_regclass('public.photo_folder_items') IS NOT NULL THEN
      PERFORM relax_tenant_isolation('photo_folder_items');
    END IF;
    IF to_regclass('public.photo_folders') IS NOT NULL THEN
      PERFORM relax_tenant_isolation('photo_folders');
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS photo_folder_items;
DROP TABLE IF EXISTS photo_folders;

-- ── The image-type registry (custom types only; built-ins live in code) ─────
CREATE TABLE IF NOT EXISTS photo_image_types (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,                 -- no DEFAULT; helper installs the loud-fail GUC default
  key             TEXT NOT NULL,                 -- matched against photos.photo_type (lowercased slug)
  label           TEXT NOT NULL,
  gcs_prefix      TEXT NOT NULL,                 -- {org}/{gcs_prefix}/{yyyy}/{mm}/… at upload
  icon            TEXT,                          -- optional Icons.tsx glyph name
  sort_index      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-org case-insensitive key uniqueness (the key is the photo_type tag).
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_image_types_org_key
  ON photo_image_types (organization_id, lower(key));

CREATE INDEX IF NOT EXISTS idx_photo_image_types_org_sort
  ON photo_image_types (organization_id, sort_index, id);

COMMENT ON TABLE photo_image_types IS
  'Operator-added custom photo image types (org-scoped). Each has a gcs_prefix (distinct bucket path) and a key matched against photos.photo_type. The five built-in scopes live in code (lib/photos/image-types.ts).';

-- Flip on FORCE RLS + loud-fail org default + canonical policy when the
-- enforcement infra is present (guarded so a fresh DB without it still gets the
-- table). The writer stamps organization_id under the GUC (see header).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('photo_image_types');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — photo_image_types left without FORCE RLS';
  END IF;
END $$;

COMMIT;
