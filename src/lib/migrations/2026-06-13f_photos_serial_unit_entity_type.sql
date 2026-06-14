-- ============================================================================
-- 2026-06-13: photos.entity_type — add SERIAL_UNIT
-- ============================================================================
-- The pack station lets a packer scan a pre-packed product's QR (the unit's
-- serial_units.unit_uid) and attach photos. Those photos hang directly off the
-- unit so any order/tracking that later resolves to the unit also resolves to
-- its photo trail. Stored polymorphically like every other photo scope:
--   (entity_type='SERIAL_UNIT', entity_id=serial_units.id)
--
-- Three additive changes, mirroring the 2026-05-24 RECEIVING_LINE migration:
--   • Extend the chk_photos_entity_type CHECK constraint.
--   • Extend the fn_validate_photo_entity_ref trigger to verify entity_id
--     against serial_units when the new type is used.
--   • Add a cascade-delete trigger so removing a serial_units row also removes
--     its photos (mirrors the RECEIVING_LINE / SKU / BIN_ADJUSTMENT path).
--
-- Re-runnable: every step is guarded by IF EXISTS / OR REPLACE so applying
-- twice is a no-op.
-- ============================================================================

BEGIN;

ALTER TABLE photos
  DROP CONSTRAINT IF EXISTS chk_photos_entity_type;

ALTER TABLE photos
  ADD CONSTRAINT chk_photos_entity_type
    CHECK (entity_type IN (
      'RECEIVING',
      'RECEIVING_LINE',
      'PACKER_LOG',
      'SKU',
      'BIN_ADJUSTMENT',
      'SERIAL_UNIT'
    ));

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
  ELSIF NEW.entity_type = 'RECEIVING_LINE' THEN
    IF NOT EXISTS (SELECT 1 FROM receiving_lines WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in receiving_lines', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'SKU' THEN
    IF NOT EXISTS (SELECT 1 FROM sku WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in sku', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'BIN_ADJUSTMENT' THEN
    IF NOT EXISTS (SELECT 1 FROM sku_stock_ledger WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in sku_stock_ledger', NEW.entity_id;
    END IF;
  ELSIF NEW.entity_type = 'SERIAL_UNIT' THEN
    IF NOT EXISTS (SELECT 1 FROM serial_units WHERE id = NEW.entity_id) THEN
      RAISE EXCEPTION 'photos.entity_id % does not exist in serial_units', NEW.entity_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported photos.entity_type: %', NEW.entity_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_photos_on_serial_unit_delete ON serial_units;
CREATE TRIGGER trg_delete_photos_on_serial_unit_delete
AFTER DELETE ON serial_units
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('SERIAL_UNIT');

COMMIT;
