-- ============================================================================
-- 2026-06-28q: drop the legacy shipment-linkage tables
--   • receiving_shipments   (INBOUND junction)  → shipment_links owner_type='RECEIVING'
--   • order_shipment_links   (OUTBOUND junction) → shipment_links owner_type='ORDER'
--   • shipment_orders        (dead, 0 rows; pre-STN Zoho-shipment table)
-- ============================================================================
-- shipment_links (owner_type/owner_id/direction/role) is now the SOLE linkage
-- SoT. All app reads were repointed to it and all writes routed through the
-- linkShipment/unlinkShipment/setPrimaryShipmentLink helpers
-- (src/lib/shipping/shipment-links.ts). The 2026-06-28p backfill made
-- shipment_links a verified superset of both live junctions.
--
-- received_at/received_by (receiving_shipments) have no column on the generic
-- shipment_links; they map to linked_at/linked_by. listBoxesForReceiving now
-- reads linked_at AS received_at (a faithful proxy for receiving — the link is
-- created at receive time).
--
-- ⚠️ DEPLOY ORDERING (hard requirement): apply ONLY AFTER the column-free /
-- table-free application code is deployed. The deployed app reads these tables
-- until the cutover ships; dropping them under an older deploy 500s order &
-- receiving tracking reads. Recoverable via Neon PITR if needed.
-- ============================================================================

BEGIN;

-- GUARD: refuse to drop unless shipment_links fully covers both live junctions.
DO $$
DECLARE missing_orders int; missing_recv int;
BEGIN
  SELECT count(*) INTO missing_orders FROM order_shipment_links o
   WHERE NOT EXISTS (SELECT 1 FROM shipment_links sl
     WHERE lower(sl.owner_type)='order' AND sl.owner_id=o.order_row_id AND sl.shipment_id=o.shipment_id);
  SELECT count(*) INTO missing_recv FROM receiving_shipments r
   WHERE NOT EXISTS (SELECT 1 FROM shipment_links sl
     WHERE lower(sl.owner_type)='receiving' AND sl.owner_id=r.receiving_id AND sl.shipment_id=r.shipment_id);
  IF missing_orders > 0 OR missing_recv > 0 THEN
    RAISE EXCEPTION 'Refusing to drop: shipment_links missing % order, % receiving link(s). Re-run 2026-06-28p backfill first.', missing_orders, missing_recv;
  END IF;
END$$;

DROP TABLE IF EXISTS receiving_shipments;
DROP TABLE IF EXISTS order_shipment_links;
DROP TABLE IF EXISTS shipment_orders;

COMMIT;
