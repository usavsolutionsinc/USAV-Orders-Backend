-- Migration: Create unified photos table, drop legacy photo storage
-- Date: 2026-03-06
-- No data backfill — old photo data is discarded.
-- Deploy updated API code reading/writing photos BEFORE running this script.

BEGIN;

-- ─── 1. Unified photos table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photos (
  id            BIGSERIAL PRIMARY KEY,
  entity_type   TEXT      NOT NULL,
  entity_id     INTEGER   NOT NULL,
  url           TEXT      NOT NULL,
  taken_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  photo_type    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photos_entity_type
    CHECK (entity_type IN ('RECEIVING', 'PACKER_LOG'))
);

-- Prevent duplicate photo rows
CREATE UNIQUE INDEX IF NOT EXISTS ux_photos_entity_url
  ON photos (entity_type, entity_id, url);

CREATE INDEX IF NOT EXISTS idx_photos_entity_created
  ON photos (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photos_taken_by_staff
  ON photos (taken_by_staff_id);

CREATE INDEX IF NOT EXISTS idx_photos_type
  ON photos (photo_type);

-- ─── 2. updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_photos_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photos_set_updated_at ON photos;
CREATE TRIGGER trg_photos_set_updated_at
BEFORE UPDATE ON photos
FOR EACH ROW EXECUTE FUNCTION fn_set_photos_updated_at();

-- ─── 3. Polymorphic entity validation trigger ────────────────────────────────
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
  ELSE
    RAISE EXCEPTION 'Unsupported photos.entity_type: %', NEW.entity_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photos_validate_entity_ref ON photos;
CREATE TRIGGER trg_photos_validate_entity_ref
BEFORE INSERT OR UPDATE ON photos
FOR EACH ROW EXECUTE FUNCTION fn_validate_photo_entity_ref();

-- ─── 4. Cascade photo cleanup when parent row is deleted ────────────────────
CREATE OR REPLACE FUNCTION fn_delete_photos_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM photos
  WHERE entity_type = TG_ARGV[0]
    AND entity_id   = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_photos_on_packer_log_delete ON packer_logs;
CREATE TRIGGER trg_delete_photos_on_packer_log_delete
AFTER DELETE ON packer_logs
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('PACKER_LOG');

DROP TRIGGER IF EXISTS trg_delete_photos_on_receiving_delete ON receiving;
CREATE TRIGGER trg_delete_photos_on_receiving_delete
AFTER DELETE ON receiving
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('RECEIVING');

-- ─── 5. Remove legacy photo storage ─────────────────────────────────────────
ALTER TABLE packer_logs
  DROP COLUMN IF EXISTS packer_photos_url;

DROP TABLE IF EXISTS receiving_photos;

COMMIT;
