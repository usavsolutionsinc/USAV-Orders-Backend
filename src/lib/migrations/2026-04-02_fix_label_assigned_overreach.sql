-- Fix: the previous migration was too broad — it advanced ALL items in shipments
-- that had tracking linked, even items without per-item allocations.
-- Only items with actual tracking allocations should be LABEL_ASSIGNED.
-- Revert the rest back to READY_TO_GO (safe default for items that were touched).

BEGIN;

-- Revert items that are LABEL_ASSIGNED but have NO per-item tracking allocation.
-- These were incorrectly advanced by the shipment-level join in the previous migration.
UPDATE fba_shipment_items fsi
SET status     = 'READY_TO_GO',
    labeled_at = NULL,
    updated_at = NOW()
WHERE fsi.status = 'LABEL_ASSIGNED'
  AND NOT EXISTS (
    SELECT 1 FROM fba_tracking_item_allocations ftia
    WHERE ftia.shipment_item_id = fsi.id
  );

-- Refresh aggregate counts on affected shipments.
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
