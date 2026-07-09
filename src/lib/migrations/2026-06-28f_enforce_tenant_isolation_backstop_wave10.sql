-- ============================================================================
-- 2026-06-28f_enforce_tenant_isolation_backstop_wave10.sql
--
-- Backstop wave 10: photo_exports — 0 rows, no in-repo writer (dead/unused).
-- FORCE is harmless (nothing to break) and closes the table at the RLS layer.
-- Guarded; revert: SELECT relax_tenant_isolation('photo_exports').
--
-- The remaining 4 (shipping_tracking_numbers, shipment_tracking_events,
-- order_ingest_queue, training_runs) are deliberately LEFT non-FORCEd:
--   * STN / STE — GLOBAL by design (team SoT, see receiving-tenant-hardening memory):
--     shared carrier-status facts; the org-sensitive linkage lives in the FORCEd
--     junctions (order_shipment_links, receiving.shipment_id, shipment_orders).
--     Reversing that to per-org FORCE is a design decision, not a leak fix.
--   * order_ingest_queue — global work-queue; rows carry org and are processed
--     per-row-org; the cross-org claim is by design, not a data exposure.
--   * training_runs — written by the external Jetson scripts/jetson/trainer.py
--     (out of this repo) with no org; FORCE+loud-fail would break the training box.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.photo_exports') IS NULL THEN
    RAISE NOTICE 'backstop_wave10: skip photo_exports (does not exist)'; RETURN;
  END IF;
  BEGIN
    PERFORM enforce_tenant_isolation('photo_exports');
    RAISE NOTICE 'backstop_wave10: FORCEd photo_exports';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'backstop_wave10: enforce(photo_exports) failed: % — left unforced', SQLERRM;
  END;
END $$;
