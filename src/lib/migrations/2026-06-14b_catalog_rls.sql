-- ============================================================================
-- 2026-06-14b_catalog_rls.sql
--
-- Arm (but do NOT enforce) row-level security on the org platform / type
-- catalog tables (platforms, platform_accounts, types — created with
-- organization_id NOT NULL + FK in 2026-06-13g). This adds ENABLE RLS + the
-- canonical org-isolation policy so the catalog joins the tenancy enforcement
-- set alongside the Phase B child tables.
--
-- ⚠ ARMED, NOT ENFORCED — same caveat as 2026-06-14_org_id_phase_b_domain_children:
-- the app connects as neondb_owner (rolbypassrls=true), which bypasses RLS
-- entirely, so this grants ZERO isolation on its own. It's correctness
-- scaffolding (ENABLE + armed policy). Real isolation begins only once the
-- non-BYPASSRLS app_tenant role is live AND enforce_tenant_isolation() FORCEs
-- each table (Phase E), gated per table on its CRUD routes being GUC-wrapped.
-- Do NOT call enforce_tenant_isolation() / FORCE here.
--
-- Note: the catalog CRUD writers pass organization_id explicitly (ctx.organizationId
-- / seedOrgCatalog), so no GUC default is added; once these tables are FORCEd
-- (Phase E) those writers must additionally be GUC-wrapped so the inserted
-- organization_id matches app.current_org.
--
-- Idempotent (DROP POLICY IF EXISTS) and roll-forward only.
-- ============================================================================

DO $$
DECLARE
  t text;
  catalog_tables text[] := ARRAY['platforms', 'platform_accounts', 'types'];
BEGIN
  FOREACH t IN ARRAY catalog_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'skipping % — table does not exist', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
    RAISE NOTICE 'armed RLS on %', t;
  END LOOP;
END $$;
