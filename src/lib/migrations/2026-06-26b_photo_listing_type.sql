-- ============================================================================
-- 2026-06-26b: seed the "listing" system photo image type
-- ============================================================================
-- "Listing" is a new photo type for the shots staff take to LIST an item for
-- sale on a marketplace (eBay/Amazon/…). Rather than a 6th hardcoded built-in
-- (which would special-case PhotoLibrarySourceScope / entityTypeForSourceScope /
-- path-builder), it is seeded as a SYSTEM custom type in photo_image_types:
--   * key = 'listing'        → photos.photo_type tag (already filterable in the
--                              library query as photoType).
--   * gcs_prefix = 'listing' → {org}/listing/{yyyy}/{mm}/… (resolveGcsPrefix
--                              picks this up automatically; no path-builder change).
--   * is_system = TRUE       → pinned above user customs (sort_index = -1) and
--                              non-deletable / non-renamable (guarded in code).
--
-- This reuses the entire custom-type machinery (sidebar rendering, photoType
-- filter, GCS prefix) with one schema change: the is_system flag.
--
-- ROLLBACK:
--   ALTER TABLE photo_image_types DROP COLUMN IF EXISTS is_system;
--   DELETE FROM photo_image_types WHERE key = 'listing';
-- ============================================================================

BEGIN;

ALTER TABLE photo_image_types
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN photo_image_types.is_system IS
  'Seeded, non-deletable system type (e.g. listing). Pinned above user customs via a negative sort_index.';

-- Seed one 'listing' system type per existing org. Idempotent on the per-org
-- key unique index; sort_index = -1 pins it first in listCustomImageTypes.
INSERT INTO photo_image_types (organization_id, key, label, gcs_prefix, icon, sort_index, is_system)
SELECT o.id, 'listing', 'Listing', 'listing', 'Tag', -1, TRUE
FROM organizations o
ON CONFLICT (organization_id, lower(key)) DO NOTHING;

COMMIT;
