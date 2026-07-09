-- ============================================================================
-- 2026-06-28p: backfill the order_shipment_links dual-write gap into
--              shipment_links (the canonical polymorphic linkage table)
-- ============================================================================
-- shipment_links (owner_type/owner_id/direction/role) is the single SoT for
-- entity↔tracking links, replacing the per-direction junctions
-- receiving_shipments (INBOUND) and order_shipment_links (OUTBOUND). The inbound
-- side is already 100% mirrored; the outbound side has a 39-row dual-write gap
-- (links written to order_shipment_links that never reached shipment_links).
-- This closes it so shipment_links is a true superset before reads are repointed
-- and the legacy tables are dropped.
--
-- Idempotent: NOT EXISTS guard; safe to re-run. Mirrors the exact row shape the
-- live dual-write produces (direction='OUTBOUND', role by is_primary, box_seq=1).
-- ============================================================================

BEGIN;

INSERT INTO shipment_links (
  organization_id, owner_type, owner_id, shipment_id,
  box_seq, is_primary, direction, role, source,
  linked_by, linked_at, metadata, created_at, updated_at
)
SELECT
  o.organization_id,
  'ORDER',
  o.order_row_id,
  o.shipment_id,
  1,
  o.is_primary,
  'OUTBOUND',
  CASE WHEN o.is_primary THEN 'ORDER_PRIMARY' ELSE 'ORDER_SPLIT' END,
  o.source,
  NULL,
  COALESCE(o.created_at, now()),
  '{}'::jsonb,
  COALESCE(o.created_at, now()),
  COALESCE(o.updated_at, now())
FROM order_shipment_links o
WHERE NOT EXISTS (
  SELECT 1 FROM shipment_links sl
  WHERE lower(sl.owner_type) = 'order'
    AND sl.owner_id = o.order_row_id
    AND sl.shipment_id = o.shipment_id
);

-- GUARD: after backfill, both legacy tables must be fully represented.
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
    RAISE EXCEPTION 'shipment_links not a superset: % order, % receiving link(s) still missing — aborting.', missing_orders, missing_recv;
  END IF;
END$$;

COMMIT;
