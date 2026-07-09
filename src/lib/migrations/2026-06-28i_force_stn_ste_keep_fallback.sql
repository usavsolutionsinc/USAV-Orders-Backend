-- ============================================================================
-- 2026-06-28i_force_stn_ste_keep_fallback.sql
--
-- FORCE RLS on shipping_tracking_numbers + shipment_tracking_events.
-- Context (2026-06-28): STN rows are now created with the CORRECT org from the
-- receiving/fba context — this session threaded org through every
-- registerShipmentPermissive caller (zoho-receiving-sync, attach-box,
-- record-scan [derives org from receiving], po-gmail link-tracking) and STE now
-- derives its org from its parent STN row (repository.ts). The carrier webhook
-- only UPDATEs status (no new rows). So per-org RLS isolation is now correct.
--
-- We ENABLE+FORCE+policy but DELIBERATELY KEEP the existing COALESCE(GUC, USAV)
-- "usav-fallback" default (do NOT swap to loud-fail): tenant-pool writers stamp
-- org = GUC (correct, passes the policy WITH CHECK); the residual session-less /
-- owner-pool no-org path bypasses FORCE on the owner pool and falls back to USAV
-- — so no writer breaks. This is the RLS-isolation step; the larger per-org
-- UNIQUE-key re-scope remains the documented product decision.
-- Revert: SELECT relax_tenant_isolation('<t>').
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipping_tracking_numbers','shipment_tracking_events'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'force_stn_ste: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policy WHERE polrelid = ('public.'||t)::regclass AND polname = 'tenant_isolation'
      ) THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I USING (organization_id = (NULLIF(current_setting(''app.current_org'', true), ''''))::uuid)',
          t
        );
      END IF;
      RAISE NOTICE 'force_stn_ste: FORCEd % (kept usav-fallback default)', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'force_stn_ste: % failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
