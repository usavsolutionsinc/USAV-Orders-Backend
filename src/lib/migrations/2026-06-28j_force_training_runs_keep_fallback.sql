-- ============================================================================
-- 2026-06-28j_force_training_runs_keep_fallback.sql
--
-- FORCE RLS on training_runs (RLS already ENABLED; just adds FORCE + policy).
-- Its only writer is the external Jetson scripts/jetson/trainer.py, which
-- connects via the owner DATABASE_URL (BYPASSRLS → FORCE-inert) and INSERTs
-- without org → the COALESCE(GUC, USAV) default lands it as USAV (no NULL
-- violation). So FORCE isolates the app's tenant-pool reads by org without
-- breaking the external trainer. We KEEP the usav-fallback default (do NOT swap
-- to loud-fail, which IS a column constraint and WOULD break the Jetson insert).
-- For USAV-only this is fully correct; multi-tenant training would need the
-- Jetson writer updated to stamp the real org (documented).
-- Revert: SELECT relax_tenant_isolation('training_runs').
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.training_runs') IS NULL THEN
    RAISE NOTICE 'skip training_runs (does not exist)'; RETURN;
  END IF;
  BEGIN
    ALTER TABLE training_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE training_runs FORCE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polrelid = 'public.training_runs'::regclass AND polname = 'tenant_isolation'
    ) THEN
      CREATE POLICY tenant_isolation ON training_runs
        USING (organization_id = (NULLIF(current_setting('app.current_org', true), ''))::uuid);
    END IF;
    RAISE NOTICE 'force_training_runs: FORCEd (kept usav-fallback default)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'force_training_runs: failed: % — left unforced', SQLERRM;
  END;
END $$;
