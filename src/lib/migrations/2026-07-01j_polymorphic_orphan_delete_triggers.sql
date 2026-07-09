-- ============================================================================
-- 2026-07-01j: orphan-on-parent-delete triggers — documents, entity_notes,
-- shipment_links (owner side), work_assignments (remaining entity types)
-- ============================================================================
-- Phase 0 of docs/todo/schema-wide-polymorphic-refactor-plan.md, Data-integrity
-- finding #3: several polymorphic/typed-fact surfaces have no parent-delete
-- integrity at all, so deleting the parent orphans (or, for work_assignments,
-- leaves stale) their rows. This closes the confirmed, low-ambiguity gaps
-- using the two patterns already established elsewhere in this schema:
--   • CASCADE-DELETE (photos' fn_delete_photos_on_parent_delete pattern) for
--     documents, entity_notes, and the owner side of shipment_links — all
--     three are link/annotation rows with no independent lifecycle once their
--     owner is gone.
--   • CANCEL (work_assignments' fn_cancel_work_assignments_on_entity_delete
--     pattern, already generic via TG_ARGV[0]) — extended to the 3
--     work_entity_type_enum values it never covered (REPAIR, FBA_SHIPMENT,
--     SKU_STOCK), alongside the existing ORDER/RECEIVING coverage.
--
-- Deliberately NOT covered here (documented, not silently dropped):
--   • documents.entity_type = 'WALK_IN_ORDER' — no confirmed writer exists
--     (the only reader, src/app/api/walk-in/receipt/[id]/route.tsx, queries a
--     `data` column that documents doesn't even have — that read path is
--     already dead) and no parent table could be confirmed. Revisit if/when
--     a real writer lands.
--   • documents.entity_type = 'SHIPPING_LABEL' — legacy alias for 'ORDER',
--     being backfilled to 'ORDER' by 2026-07-01d. Covered here anyway (same
--     parent table, `orders`) so any stragglers get cleaned up too.
--
-- Every statement is idempotent (DROP TRIGGER IF EXISTS + CREATE OR REPLACE
-- FUNCTION), safe to re-run.
-- ============================================================================

BEGIN;

-- ── documents: cascade-delete on its confirmed parents ──────────────────────
CREATE OR REPLACE FUNCTION fn_delete_documents_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM documents
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_documents_on_order_delete ON orders;
CREATE TRIGGER trg_delete_documents_on_order_delete
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_documents_on_parent_delete('ORDER');

DROP TRIGGER IF EXISTS trg_delete_documents_on_order_shipping_label_delete ON orders;
CREATE TRIGGER trg_delete_documents_on_order_shipping_label_delete
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_documents_on_parent_delete('SHIPPING_LABEL');

DROP TRIGGER IF EXISTS trg_delete_documents_on_repair_service_delete ON repair_service;
CREATE TRIGGER trg_delete_documents_on_repair_service_delete
AFTER DELETE ON repair_service
FOR EACH ROW EXECUTE FUNCTION fn_delete_documents_on_parent_delete('REPAIR');

-- ── entity_notes: cascade-delete on its one confirmed parent ────────────────
-- entity_notes.entity_id is UUID (the only UUID-keyed polymorphic surface),
-- matching sales_orders.id; the only writer (salesOrderRepository.ts) only
-- ever uses entity_type = 'sales_order'.
CREATE OR REPLACE FUNCTION fn_delete_entity_notes_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM entity_notes
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_entity_notes_on_sales_order_delete ON sales_orders;
CREATE TRIGGER trg_delete_entity_notes_on_sales_order_delete
AFTER DELETE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_notes_on_parent_delete('sales_order');

-- ── shipment_links: cascade-delete on the owner side (RECEIVING / ORDER) ────
-- The non-owner side (shipment_id -> shipping_tracking_numbers) already has a
-- real ON DELETE CASCADE FK; this closes the owner side the birth migration's
-- own header flagged as a planned-but-never-created Phase 4 trigger.
CREATE OR REPLACE FUNCTION fn_delete_shipment_links_on_owner_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM shipment_links
  WHERE owner_type = TG_ARGV[0]
    AND owner_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_shipment_links_on_receiving_delete ON receiving;
CREATE TRIGGER trg_delete_shipment_links_on_receiving_delete
AFTER DELETE ON receiving
FOR EACH ROW EXECUTE FUNCTION fn_delete_shipment_links_on_owner_delete('RECEIVING');

DROP TRIGGER IF EXISTS trg_delete_shipment_links_on_order_delete ON orders;
CREATE TRIGGER trg_delete_shipment_links_on_order_delete
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_shipment_links_on_owner_delete('ORDER');

-- ── work_assignments: extend the existing cancel-on-delete family ──────────
-- fn_cancel_work_assignments_on_entity_delete() already dispatches generically
-- on TG_ARGV[0]::work_entity_type_enum; only ORDER/RECEIVING had a
-- CREATE TRIGGER wired up. Add the remaining 3 work_entity_type_enum values.
DROP TRIGGER IF EXISTS trg_cancel_wa_on_repair_service_delete ON repair_service;
CREATE TRIGGER trg_cancel_wa_on_repair_service_delete
  BEFORE DELETE ON repair_service
  FOR EACH ROW
  EXECUTE FUNCTION fn_cancel_work_assignments_on_entity_delete('REPAIR');

DROP TRIGGER IF EXISTS trg_cancel_wa_on_fba_shipment_delete ON fba_shipments;
CREATE TRIGGER trg_cancel_wa_on_fba_shipment_delete
  BEFORE DELETE ON fba_shipments
  FOR EACH ROW
  EXECUTE FUNCTION fn_cancel_work_assignments_on_entity_delete('FBA_SHIPMENT');

DROP TRIGGER IF EXISTS trg_cancel_wa_on_sku_stock_delete ON sku_stock;
CREATE TRIGGER trg_cancel_wa_on_sku_stock_delete
  BEFORE DELETE ON sku_stock
  FOR EACH ROW
  EXECUTE FUNCTION fn_cancel_work_assignments_on_entity_delete('SKU_STOCK');

COMMIT;
