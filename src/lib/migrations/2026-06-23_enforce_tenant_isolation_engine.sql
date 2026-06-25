-- ============================================================================
-- 2026-06-23_enforce_tenant_isolation_engine.sql
--
-- FORCE RLS on the workflow-engine tables + zoho_locations. enforce_tenant_isolation
-- ENABLEs RLS + creates the tenant_isolation policy + FORCEs in one step (these 4
-- engine tables had org_id NOT NULL but no policy yet).
--
-- SAFETY: the engine store/tap/node-stats use the neon-http Drizzle client
-- (`@/lib/drizzle/db` → DATABASE_URL = neondb_owner, BYPASSRLS), so FORCE does NOT
-- lock the engine out (owner bypasses) — the plan's "FORCE locks the engine out"
-- caveat assumed the store ran as app_tenant; verified it runs as owner. Every
-- engine INSERT stamps organization_id explicitly (store.ts enrollItem/recordRun,
-- node-stats.ts:36, recover.ts:107, studio definitions.ts:108 / templates.ts:142),
-- so the loud-fail default never NULL-fails. withTenantDrizzle consumers (e.g.
-- catalog/workflow-nodes) become RLS-scoped. C5 (moving the engine store ONTO
-- withTenantDrizzle for RLS-isolated reads) is a separate hardening, not required
-- for this switch. Revert per table: relax_tenant_isolation(<t>).
--
-- NOT here: workflow_nodes / workflow_edges (no organization_id column — child-
-- scoped via workflow_definitions FK; need a Phase-B denormalize first).
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'item_workflow_state', 'workflow_runs', 'workflow_node_stats', 'workflow_definitions',
    'zoho_locations'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'engine: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'engine: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'engine: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
