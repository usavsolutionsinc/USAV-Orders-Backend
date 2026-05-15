-- ============================================================================
-- 2026-05-14: Extend photos validation trigger for BIN_ADJUSTMENT
-- ============================================================================
-- Lets /api/inventory-photos attach photo evidence to sku_stock_ledger rows
-- (entity_type = 'BIN_ADJUSTMENT', entity_id = sku_stock_ledger.id).
--
-- Also wires a cascade-delete trigger so removing a ledger row removes its
-- attached photos. Ledger rows are append-only in practice, but consistency
-- with the existing PACKER_LOG / RECEIVING pattern is worth the few lines.
-- ============================================================================

BEGIN;

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

DROP TRIGGER IF EXISTS trg_delete_photos_on_sku_stock_ledger_delete ON sku_stock_ledger;
CREATE TRIGGER trg_delete_photos_on_sku_stock_ledger_delete
AFTER DELETE ON sku_stock_ledger
FOR EACH ROW EXECUTE FUNCTION fn_delete_photos_on_parent_delete('BIN_ADJUSTMENT');

COMMIT;
