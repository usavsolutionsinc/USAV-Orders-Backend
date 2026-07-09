-- ============================================================================
-- 2026-06-25: photo_folders.source_scope — tag a master folder with an image type
-- ============================================================================
-- Master folders (2026-06-23_photo_folders.sql) were image-type agnostic. The
-- photo library's sidebar is organized by "image type" (the source scope:
-- unboxing / local_pickup / packing / repair / claims). Operators now create a
-- folder *under* the currently-selected image type via the "+" button, so a
-- folder can optionally belong to one scope.
--
-- NULLABLE on purpose: existing folders (and any created without a scope) stay
-- type-agnostic and surface regardless of the active image type. 'all' is never
-- stored — it is the absence of a scope, i.e. NULL.
--
-- Tenant-from-birth already enforced on photo_folders; this only adds a column,
-- so no RLS changes are needed.
--
-- ROLLBACK:
--   ALTER TABLE photo_folders DROP CONSTRAINT IF EXISTS photo_folders_source_scope_chk;
--   ALTER TABLE photo_folders DROP COLUMN IF EXISTS source_scope;
-- ============================================================================

BEGIN;

ALTER TABLE photo_folders
  ADD COLUMN IF NOT EXISTS source_scope TEXT;

-- Constrain to the known image-type scopes (NULL = untyped / "all"). Guarded so
-- a re-run doesn't error on the already-present constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'photo_folders_source_scope_chk'
  ) THEN
    ALTER TABLE photo_folders
      ADD CONSTRAINT photo_folders_source_scope_chk
      CHECK (source_scope IS NULL OR source_scope IN
        ('unboxing', 'local_pickup', 'packing', 'repair', 'claims'));
  END IF;
END $$;

COMMENT ON COLUMN photo_folders.source_scope IS
  'Optional image-type (library source scope) this folder belongs to. NULL = untyped / shows under every type. Never stores ''all''.';

-- Filter the folder tree by the active image type without a full scan.
CREATE INDEX IF NOT EXISTS idx_photo_folders_org_scope
  ON photo_folders (organization_id, source_scope);

COMMIT;
