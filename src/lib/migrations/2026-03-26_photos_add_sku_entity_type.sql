-- Migration: Extend photos entity_type constraint to include SKU
-- Date: 2026-03-26
-- Allows photo records to be linked to sku table rows for integrity verification.

BEGIN;

-- Drop the old CHECK constraint and replace with one that includes 'SKU'
ALTER TABLE photos
  DROP CONSTRAINT IF EXISTS chk_photos_entity_type;

ALTER TABLE photos
  ADD CONSTRAINT chk_photos_entity_type
    CHECK (entity_type IN ('RECEIVING', 'PACKER_LOG', 'SKU'));

-- Extend the entity-ref validation trigger to handle SKU rows
CREATE OR REPLACE FUNCTION fn_validate_photo_entity_ref()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type = 'PACKER_LOG' THEN
    IF NOT EXISTS (SELECT 1 FROM packer_logs WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in packer_logs', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'RECEIVING' THEN
    IF NOT EXISTS (SELECT 1 FROM receiving WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in receiving', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'SKU' THEN
    IF NOT EXISTS (SELECT 1 FROM sku WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in sku', NEW.entity_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported photos.entity_type: %', NEW.entity_type;
  END IF;
  RETURN NEW;
END;
$$;

-- Cascade photo cleanup when a sku row is deleted
CREATE OR REPLACE FUNCTION fn_delete_photos_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM photos
  WHERE entity_type = TG_ARGV[0]
    AND entity_id   = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_photos_on_sku_delete ON sku;
CREATE TRIGGER trg_delete_photos_on_sku_delete
AFTER DELETE ON sku
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('SKU');

COMMIT;
