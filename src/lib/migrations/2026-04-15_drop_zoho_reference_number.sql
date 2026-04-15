-- ============================================================================
-- 2026-04-15: Phase 9a — drop receiving_lines.zoho_reference_number
-- ============================================================================
-- Superseded by shipping_tracking_numbers (joined from receiving.shipment_id).
-- The Zoho sync stopped writing this column in Phase 3; the backfill moved
-- its values onto shipping_tracking_numbers in Phase 6.
--
-- Phase 9b (dropping receiving.receiving_tracking_number + receiving.carrier)
-- is NOT in this migration. Those columns are still carrying LOCAL-xxx
-- local-pickup identifiers that haven't been relocated — dropping them here
-- would break /api/local-pickups and the work-orders local-pickup queue.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_receiving_lines_zoho_reference;

ALTER TABLE receiving_lines
  DROP COLUMN IF EXISTS zoho_reference_number;

COMMIT;
