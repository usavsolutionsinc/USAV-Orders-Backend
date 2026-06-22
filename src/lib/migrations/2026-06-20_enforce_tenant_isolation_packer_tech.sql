-- ============================================================================
-- 2026-06-20_enforce_tenant_isolation_packer_tech.sql
--
-- Phase E (per-table FORCE) for packer_logs + tech_serial_numbers. Same model as
-- the receiving-core wave: enforce_tenant_isolation() flips the org default to
-- loud-fail + ENABLE/FORCE RLS + tenant_isolation policy.
--
-- SAFE TO APPLY: both have organization_id NOT NULL (0 NULL rows). Every
-- PRODUCTION writer now stamps org (audited + threaded 2026-06-20):
--   packer_logs        — pack/ship, google-sheets, packing-logs route (×4),
--                        packing-logs/update, sync-sheets syncPackerSheets.
--                        (createPackingLog in neon/packing-logs-queries = dead.)
--   tech_serial_numbers— google-sheets, receiving/serials, sync-sheets
--                        syncTechSheets, and attachTechSerial (all prod callers
--                        pass org). (createTechLog dead; unit-events.recordUnitEvent
--                        is test-only — not a runtime writer.)
--
-- NOT included: serial_units — its canonical upsertSerialUnit has an unscoped
-- path whose callers need GUC-wrap / orgId verification first (follow-up).
--
-- Rollback: select relax_tenant_isolation('<table>').
-- ============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['packer_logs','tech_serial_numbers'];
  exists_ boolean;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=''public'' AND table_name=%L)', t) INTO exists_;
    IF NOT exists_ THEN RAISE NOTICE 'skip % (absent)', t; CONTINUE; END IF;
    PERFORM enforce_tenant_isolation(t::regclass);
    RAISE NOTICE 'FORCED tenant isolation on %', t;
  END LOOP;
END $$;
