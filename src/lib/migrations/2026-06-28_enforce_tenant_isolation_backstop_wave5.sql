-- ============================================================================
-- 2026-06-28_enforce_tenant_isolation_backstop_wave5.sql
--
-- Backstop wave 5: tables that became FORCE-ready after this session's route
-- conversions (admin/photos/stats → tenantQuery) and whose every writer was
-- verified (2026-06-28) to stamp organization_id explicitly:
--   photo_analysis        — analyze.ts:217 INSERT (… organization_id …); admin/photos/stats now tenantQuery
--   photo_storage         — mirror-nas.ts:106 / service.ts:108,205 / mirror-drive.ts:92 all INSERT explicit org
--   zoho_fulfillment_sync — fulfillment-sync.ts:126 INSERT explicit org; the cron route's only "hit" is the JS
--                           const CURSOR_KEY='zoho_fulfillment_sync' (sync_cursors), not a table query (false positive)
--
-- routes + writers clean → FORCE is safe (no writer breaks) AND complete (no
-- owner-pool reader silently bypasses; remaining reads are keyed by photo_id /
-- cursor and org-resolved). Idempotent + guarded.
-- Revert one table: SELECT relax_tenant_isolation('<t>').
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'photo_analysis',
    'photo_storage',
    'zoho_fulfillment_sync'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave5: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave5: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave5: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
