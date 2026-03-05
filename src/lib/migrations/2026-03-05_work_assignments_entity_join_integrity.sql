-- Migration: Strengthen work_assignments ↔ orders/receiving join reliability
--   1. Remove duplicate active-unique index
--   2. Add partial indexes for ORDER and RECEIVING entity lookups
--   3. Add packer assignment queue index (mirrors tech index)
--   4. Add composite index on orders.id + is_shipped for fast lateral joins
--   5. Cascade-delete trigger: deleting an order/receiving row auto-cancels
--      its work_assignments (no dangling entity_id references)
--   6. Purge any orphaned work_assignments already in the DB
-- Date: 2026-03-05

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Remove duplicate active-unique index (keep ux_work_assignments_active_entity)
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_work_assignments_active_unique;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Partial indexes for ORDER and RECEIVING lateral join patterns
--    Pattern used by every query:
--      WHERE entity_type = 'ORDER' AND entity_id = o.id
--        AND work_type = 'TEST' AND status IN ('ASSIGNED','IN_PROGRESS')
-- ─────────────────────────────────────────────────────────────────────────────

-- Fast lookup of active ORDER assignments
CREATE INDEX IF NOT EXISTS idx_wa_order_entity_active
  ON work_assignments (entity_id, work_type, status)
  WHERE entity_type = 'ORDER'
    AND status IN ('ASSIGNED', 'IN_PROGRESS');

-- Fast lookup of active RECEIVING assignments
CREATE INDEX IF NOT EXISTS idx_wa_receiving_entity_active
  ON work_assignments (entity_id, work_type, status)
  WHERE entity_type = 'RECEIVING'
    AND status IN ('ASSIGNED', 'IN_PROGRESS');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Packer assignment queue index (mirrors idx_work_assignments_assignee_status)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wa_packer_queue
  ON work_assignments (assigned_packer_id, status, work_type, priority, assigned_at)
  WHERE assigned_packer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Composite index on orders.id + is_shipped – used by JOIN + WHERE together
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_id_is_shipped
  ON orders (id, is_shipped);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger functions: cascade-delete work_assignments on orders/receiving delete
--    Uses CANCEL rather than hard-delete so audit history is preserved.
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger function shared by both tables
CREATE OR REPLACE FUNCTION fn_cancel_work_assignments_on_entity_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE work_assignments
  SET
    status     = 'CANCELED',
    updated_at = NOW()
  WHERE entity_type = TG_ARGV[0]::work_entity_type_enum
    AND entity_id   = OLD.id
    AND status IN ('ASSIGNED', 'IN_PROGRESS');
  RETURN OLD;
END;
$$;

-- Trigger on orders
DROP TRIGGER IF EXISTS trg_cancel_wa_on_order_delete ON orders;
CREATE TRIGGER trg_cancel_wa_on_order_delete
  BEFORE DELETE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_cancel_work_assignments_on_entity_delete('ORDER');

-- Trigger on receiving
DROP TRIGGER IF EXISTS trg_cancel_wa_on_receiving_delete ON receiving;
CREATE TRIGGER trg_cancel_wa_on_receiving_delete
  BEFORE DELETE ON receiving
  FOR EACH ROW
  EXECUTE FUNCTION fn_cancel_work_assignments_on_entity_delete('RECEIVING');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Purge orphaned work_assignments already in the DB
--    (entity_id references a row that no longer exists)
-- ─────────────────────────────────────────────────────────────────────────────

-- Cancel orphaned ORDER assignments
UPDATE work_assignments
SET status = 'CANCELED', updated_at = NOW()
WHERE entity_type = 'ORDER'
  AND status IN ('ASSIGNED', 'IN_PROGRESS')
  AND NOT EXISTS (
    SELECT 1 FROM orders WHERE orders.id = work_assignments.entity_id
  );

-- Cancel orphaned RECEIVING assignments
UPDATE work_assignments
SET status = 'CANCELED', updated_at = NOW()
WHERE entity_type = 'RECEIVING'
  AND status IN ('ASSIGNED', 'IN_PROGRESS')
  AND NOT EXISTS (
    SELECT 1 FROM receiving WHERE receiving.id = work_assignments.entity_id
  );

COMMIT;
