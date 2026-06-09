-- ============================================================================
-- 2026-06-08: STN consolidation — receiving_scans.shipment_id (Phase 6, step 1)
-- ============================================================================
-- Receiving-triage streamline Phase 6 (docs/receiving-triage-streamline-plan.md).
--
-- Step 1 of completing the inbound-tracking unification ("Phase 9" in
-- 2026-04-15_receiving_attach_shipment_id.sql): make receiving_scans reference
-- the canonical tracking row (shipping_tracking_numbers) by id, so a dock-scan
-- event links to STN instead of relying on its denormalized tracking_number
-- string. The scan stays a recorded FACT (the operator scanned this carton); it
-- just stops carrying its own copy of the tracking string.
--
-- NULLABLE on purpose: an operator can scan a tracking that has no STN row yet
-- (scan-before-webhook) or a non-carrier code; the dock event must still record.
-- lookup-po registers the STN permissively at scan time and back-stamps this.
--
-- ADDITIVE + idempotent. NOTHING is dropped here. The legacy TEXT columns
-- (receiving_scans.tracking_number/carrier, receiving.receiving_tracking_number,
-- receiving_lines reference cols) are dropped only in a LATER migration, AFTER
-- backfill + dual-write have baked and the read paths cut over (see plan §6).
-- ============================================================================

BEGIN;

ALTER TABLE receiving_scans
  ADD COLUMN IF NOT EXISTS shipment_id BIGINT
    REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_scans_shipment_id
  ON receiving_scans(shipment_id)
  WHERE shipment_id IS NOT NULL;

COMMENT ON COLUMN receiving_scans.shipment_id IS
  'FK to shipping_tracking_numbers (Phase 6 STN consolidation). Links the dock-scan event to the canonical tracking row by id; replaces the denormalized tracking_number/carrier strings (dropped in a later migration after bake). Nullable — a scan-before-STN / non-carrier code still records the event.';

COMMIT;
