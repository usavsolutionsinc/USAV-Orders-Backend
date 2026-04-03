-- Backfill: advance items that already have tracking allocations from
-- PLANNED/PACKING/READY_TO_GO → LABEL_ASSIGNED.
--
-- These items were combined into shipment cards (tracking was linked)
-- but the old code never advanced their status. After this migration,
-- the board query excludes LABEL_ASSIGNED items so they only appear
-- on shipment cards.

BEGIN;

-- 1. Advance items that have tracking allocations and are still in a pre-label state.
UPDATE fba_shipment_items fsi
SET status     = 'LABEL_ASSIGNED',
    labeled_at = COALESCE(fsi.labeled_at, NOW()),
    updated_at = NOW()
FROM fba_tracking_item_allocations ftia
WHERE ftia.shipment_item_id = fsi.id
  AND fsi.status IN ('PLANNED', 'PACKING', 'READY_TO_GO');

-- 2. (Removed — shipment-level tracking link does NOT mean all items are combined.
--     Only items with per-item allocations in fba_tracking_item_allocations should advance.)

-- 3. Refresh aggregate counts on affected shipments.
UPDATE fba_shipments fs
SET ready_item_count   = counts.ready,
    packed_item_count  = counts.packed,
    shipped_item_count = counts.shipped,
    updated_at         = NOW()
FROM (
  SELECT shipment_id,
    COUNT(*) FILTER (WHERE status IN ('READY_TO_GO','LABEL_ASSIGNED','SHIPPED'))::int AS ready,
    COUNT(*) FILTER (WHERE status IN ('LABEL_ASSIGNED','SHIPPED'))::int AS packed,
    COUNT(*) FILTER (WHERE status = 'SHIPPED')::int AS shipped
  FROM fba_shipment_items
  GROUP BY shipment_id
) counts
WHERE fs.id = counts.shipment_id;

COMMIT;
