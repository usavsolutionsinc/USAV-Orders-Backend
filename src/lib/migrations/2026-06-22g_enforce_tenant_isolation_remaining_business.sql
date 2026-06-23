-- ============================================================================
-- 2026-06-22g_enforce_tenant_isolation_remaining_business.sql
--
-- Final per-tenant FORCE batch: the remaining business tables Phase B left with
-- a NULLABLE organization_id but which (verified 2026-06-22) carry ZERO NULL-org
-- rows and a USAV-FALLBACK default. SET NOT NULL (safe — 0 nulls), then FORCE.
-- USAV-fallback default means new owner-pool inserts stamp USAV (no NOT-NULL
-- break); writers stamp org; no direct tenantPool usage ⇒ non-breaking in dogfood.
--
-- Tables: part_acquisitions, picking_sessions, product_manuals, rma_authorizations,
-- staff_goals, staff_stations, staff_todo_completions, suppliers, warehouses,
-- square_transactions, mobile_scan_events, zoho_po_mirror, messages.
--
-- (square_transactions/webhook + zoho_po_mirror writers stamp org via the cron/
-- webhook org-resolution from Phase D Waves 3-4; D1 Square→org map is a later
-- refinement but does not block this FORCE — current writer stamps a real org.)
--
-- Per-table fault isolation; revert per table: relax_tenant_isolation(<t>).
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'part_acquisitions', 'picking_sessions', 'product_manuals', 'rma_authorizations',
    'staff_goals', 'staff_stations', 'staff_todo_completions', 'suppliers', 'warehouses',
    'square_transactions', 'mobile_scan_events', 'zoho_po_mirror', 'messages'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'remaining_business: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'remaining_business: NOT NULL + FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'remaining_business: %(%) — left as-is', SQLERRM, t;
    END;
  END LOOP;
END $$;
