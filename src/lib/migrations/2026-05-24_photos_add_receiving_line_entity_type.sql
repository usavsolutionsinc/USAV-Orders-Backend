-- ============================================================================
-- 2026-05-24: photos.entity_type — add RECEIVING_LINE
-- ============================================================================
-- The mobile receiving pipeline (/m/receiving) lets receivers attach photos
-- at two scopes:
--   1) PO-level     — already supported as (entity_type='RECEIVING',
--                     entity_id=receiving.id). Untouched here.
--   2) Item-level   — bound to a single Purchase Order Item, i.e. one
--                     receiving_lines row. Stored polymorphically as
--                     (entity_type='RECEIVING_LINE', entity_id=receiving_lines.id),
--                     matching the existing pattern used for RECEIVING /
--                     PACKER_LOG / SKU / BIN_ADJUSTMENT.
--
-- Three additive changes:
--   • Extend the chk_photos_entity_type CHECK constraint.
--   • Extend the fn_validate_photo_entity_ref trigger to verify entity_id
--     against receiving_lines when the new type is used.
--   • Add a cascade-delete trigger so removing a receiving_lines row also
--     removes its item-level photos (mirrors the SKU / BIN_ADJUSTMENT path).
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
      'BIN_ADJUSTMENT'
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
  ELSE
    RAISE EXCEPTION 'Unsupported photos.entity_type: %', NEW.entity_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_photos_on_receiving_line_delete ON receiving_lines;
CREATE TRIGGER trg_delete_photos_on_receiving_line_delete
AFTER DELETE ON receiving_lines
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('RECEIVING_LINE');

COMMIT;
