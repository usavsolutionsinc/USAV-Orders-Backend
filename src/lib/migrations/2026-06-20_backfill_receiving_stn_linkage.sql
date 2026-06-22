-- ============================================================================
-- 2026-06-20_backfill_receiving_stn_linkage.sql
--
-- Backfill the receiving ↔ shipping_tracking_numbers (STN) linkage so the
-- polymorphic, junction-based shipment model is actually populated. Pure DATA
-- (no DDL, no constraint changes) — safe to apply independent of code deploys.
--
-- Gaps found 2026-06-20 (prod): receiving_shipments junction is EMPTY (0 rows)
-- while 1,496 receiving rows carry a legacy single shipment_id; 204 receiving_
-- lines could inherit their carton's STN; 282 receiving rows hold a legacy
-- tracking# never linked to an STN id.
-- ============================================================================

BEGIN;

-- 1. STN org safety net (idempotent; prod currently has 0 NULLs). Derive from a
--    linked receiving carton first, then orders, else USAV (single tenant today).
UPDATE shipping_tracking_numbers stn
   SET organization_id = r.organization_id
  FROM receiving r
 WHERE stn.organization_id IS NULL
   AND r.shipment_id = stn.id
   AND r.organization_id IS NOT NULL;

UPDATE shipping_tracking_numbers stn
   SET organization_id = o.organization_id
  FROM orders o
 WHERE stn.organization_id IS NULL
   AND o.shipment_id = stn.id
   AND o.organization_id IS NOT NULL;

UPDATE shipping_tracking_numbers
   SET organization_id = '00000000-0000-0000-0000-000000000001'
 WHERE organization_id IS NULL;

-- 2. Populate the receiving_shipments junction from the legacy single
--    receiving.shipment_id. One primary box per carton (box_seq 1, is_primary),
--    inheriting the carton's org + received_at/by. ON CONFLICT keeps it
--    idempotent against ux_receiving_shipments(receiving_id, shipment_id).
INSERT INTO receiving_shipments
  (receiving_id, shipment_id, box_seq, is_primary, received_at, received_by, organization_id)
SELECT r.id, r.shipment_id, 1, true, r.received_at, r.received_by, r.organization_id
  FROM receiving r
 WHERE r.shipment_id IS NOT NULL
ON CONFLICT (receiving_id, shipment_id) DO NOTHING;

-- 3. Direct line→STN link: backfill receiving_lines.shipment_id from the parent
--    carton's shipment_id where unset. Retires the LATERAL PO#-guess for these
--    rows (the direct-link model from 2026-06-08_inbound_handling_unit).
UPDATE receiving_lines rl
   SET shipment_id = r.shipment_id,
       updated_at  = NOW()
  FROM receiving r
 WHERE rl.receiving_id = r.id
   AND rl.shipment_id IS NULL
   AND r.shipment_id IS NOT NULL;

-- 4. Best-effort recovery: link the 282 receiving rows that hold a legacy
--    tracking# but no shipment_id to an EXISTING STN by normalized match. No new
--    STN rows are minted here (many of those values are Zoho PO refs, not
--    carrier tracking) — registerShipmentPermissive owns minting at scan time.
UPDATE receiving r
   SET shipment_id = stn.id,
       updated_at  = NOW()
  FROM shipping_tracking_numbers stn
 WHERE r.shipment_id IS NULL
   AND r.receiving_tracking_number IS NOT NULL
   AND btrim(r.receiving_tracking_number) <> ''
   AND stn.tracking_number_normalized =
       NULLIF(upper(regexp_replace(r.receiving_tracking_number, '[^A-Za-z0-9]', '', 'g')), '');

COMMIT;
