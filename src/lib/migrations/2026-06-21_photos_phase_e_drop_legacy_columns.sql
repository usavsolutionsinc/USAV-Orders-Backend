-- Migration: Phase E — drop legacy photos.entity_type / entity_id / url
-- Relationships live in photo_entity_links; bytes in photo_storage.
-- docs/photos-platform-plan.md §14 Phase E

BEGIN;

-- Parent-delete cascade now goes through photo_entity_links
CREATE OR REPLACE FUNCTION fn_delete_photos_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM photos p
   WHERE p.id IN (
     SELECT l.photo_id
       FROM photo_entity_links l
      WHERE l.entity_type = TG_ARGV[0]
        AND l.entity_id = OLD.id
   );
  RETURN OLD;
END;
$$;

-- Entity validation moves to application + photo_entity_links inserts
DROP TRIGGER IF EXISTS trg_photos_validate_entity_ref ON photos;
DROP FUNCTION IF EXISTS fn_validate_photo_entity_ref();

DROP INDEX IF EXISTS ux_photos_entity_url;
DROP INDEX IF EXISTS idx_photos_entity_created;
DROP INDEX IF EXISTS idx_photos_google_pending;
DROP INDEX IF EXISTS idx_photos_google_album;

ALTER TABLE photos DROP COLUMN IF EXISTS entity_type;
ALTER TABLE photos DROP COLUMN IF EXISTS entity_id;
ALTER TABLE photos DROP COLUMN IF EXISTS url;
ALTER TABLE photos DROP COLUMN IF EXISTS google_photos_id;
ALTER TABLE photos DROP COLUMN IF EXISTS google_product_url;
ALTER TABLE photos DROP COLUMN IF EXISTS google_album_id;
ALTER TABLE photos DROP COLUMN IF EXISTS google_filename;
ALTER TABLE photos DROP COLUMN IF EXISTS uploaded_to_google_at;

-- Dedup legacy URL attaches per entity (replaces ux_photos_entity_url)
CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_org_entity_legacy
  ON photo_storage (organization_id, legacy_url)
  WHERE legacy_url IS NOT NULL AND is_primary = TRUE;

COMMIT;
