-- ============================================================================
-- Backfill for 2026-06-08_inbound_handling_unit (receiving-triage Phase 3)
-- ============================================================================
-- Run AFTER the migration, BEFORE flipping RECEIVING_UNIFIED_INBOUND. Idempotent
-- and safe to re-run. Wrapped per-statement so a partial run can resume.
--
--   1. receiving_lines.shipment_id ← the carton's receiving.shipment_id, for
--      lines already attached to a receiving row that carries a shipment. This
--      is the bulk of historical linkage and needs no Zoho calls.
--   2. receiving.lpn ← a deterministic plate for existing cartons that lack one,
--      so lookup-po's LPN-primary path has a key. Format: RC-<receiving.id>
--      (collision-free by construction; the live sequence keeps issuing these).
-- ============================================================================

-- 1) Line → shipment, via the already-linked receiving row.
UPDATE receiving_lines rl
   SET shipment_id = r.shipment_id
  FROM receiving r
 WHERE rl.receiving_id = r.id
   AND r.shipment_id IS NOT NULL
   AND rl.shipment_id IS DISTINCT FROM r.shipment_id;

-- 2) LPN for existing cartons missing one. RC-<id> is stable + unique.
UPDATE receiving
   SET lpn = 'RC-' || id::text
 WHERE lpn IS NULL;

-- Sanity (run manually):
--   SELECT count(*) FILTER (WHERE shipment_id IS NOT NULL) AS linked,
--          count(*)                                        AS total
--     FROM receiving_lines;
--   SELECT count(*) FILTER (WHERE lpn IS NOT NULL) AS plated, count(*) AS total
--     FROM receiving;
