-- ============================================================================
-- 2026-06-28g_enforce_tenant_isolation_backstop_wave11.sql
--
-- Backstop wave 11: order_ingest_queue. Empty today (0 rows); its sole enqueue
-- writer (api/zoho/orders/ingest:35) stamps organization_id explicitly; the
-- global drain runs on the owner pool (FORCE-inert) so per-org isolation on the
-- tenant pool doesn't disturb the cross-org claim. Safe + complete.
--
-- The FINAL 3 stay non-FORCEd, each a hard external/structural blocker:
--   shipping_tracking_numbers / shipment_tracking_events — the carrier-sync /
--     webhook writers (lib/shipping/repository.ts:68,224) INSERT WITHOUT org
--     (rely on the usav-fallback default), and the webhook cannot resolve org
--     from the carrier payload. FORCE+loud-fail would break those writes. Needs
--     webhook org-resolution first (also STN is GLOBAL by design — team SoT).
--   training_runs — external Jetson scripts/jetson/trainer.py writes it with no
--     org; out of this repo. Patch the Jetson writer first.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.order_ingest_queue') IS NULL THEN
    RAISE NOTICE 'backstop_wave11: skip order_ingest_queue (does not exist)'; RETURN;
  END IF;
  BEGIN
    PERFORM enforce_tenant_isolation('order_ingest_queue');
    RAISE NOTICE 'backstop_wave11: FORCEd order_ingest_queue';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'backstop_wave11: enforce(order_ingest_queue) failed: % — left unforced', SQLERRM;
  END;
END $$;
