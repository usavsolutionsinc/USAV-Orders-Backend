-- ============================================================================
-- Backfill for 2026-06-08_stn_consolidation (receiving-triage Phase 6, step 1)
-- ============================================================================
-- Run AFTER the migration, alongside RECEIVING_UNIFIED_INBOUND dual-write.
-- Idempotent + re-runnable. Two passes, most-reliable first:
--
--   1) From the carton's already-resolved STN link (receiving.shipment_id) —
--      the bulk of historical scans, no tracking parsing needed.
--   2) From the scan's own tracking_number matched to STN by normalized value —
--      catches scans whose carton never carried a shipment_id. Uses the same
--      normalization the app uses (upper, strip non-alphanumerics).
-- ============================================================================

-- 1) Via the linked carton.
UPDATE receiving_scans rs
   SET shipment_id = r.shipment_id
  FROM receiving r
 WHERE rs.receiving_id = r.id
   AND r.shipment_id IS NOT NULL
   AND rs.shipment_id IS DISTINCT FROM r.shipment_id;

-- 2) Via the scan's own tracking_number → STN (normalized match). Only fills
--    rows still NULL after pass 1. Last-8 fallback mirrors lookup-po's matcher.
UPDATE receiving_scans rs
   SET shipment_id = stn.id
  FROM shipping_tracking_numbers stn
 WHERE rs.shipment_id IS NULL
   AND COALESCE(rs.tracking_number, '') <> ''
   AND right(stn.tracking_number_normalized, 8) = right(
         regexp_replace(upper(rs.tracking_number), '[^A-Z0-9]', '', 'g'), 8);

-- Sanity (run manually):
--   SELECT count(*) FILTER (WHERE shipment_id IS NOT NULL) AS linked,
--          count(*)                                        AS total
--     FROM receiving_scans;
