-- ============================================================================
-- 2026-06-19_enforce_tenant_isolation_receiving_core.sql
--
-- Phase E (per-table FORCE) for the RECEIVING CORE tables. Calls the
-- enforce_tenant_isolation() helper (2026-06-14_rls_enforcement_infra.sql) on
-- each receiving-owned table. For one table the helper atomically:
--   1. Flips organization_id DEFAULT from the USAV-fallback to a LOUD-FAIL
--      (nullif(current_setting('app.current_org'))::uuid) — an INSERT with no
--      org stamped AND no app.current_org GUC now violates NOT NULL instead of
--      silently landing under USAV.
--   2. ENABLE + FORCE ROW LEVEL SECURITY.
--   3. (Re)creates the canonical tenant_isolation policy (USING + WITH CHECK on
--      organization_id = current_setting('app.current_org')::uuid).
--   4. Preserves the hermes_agent cross-tenant READ bypass.
--
-- ── GATING (why this is safe to apply now) ──────────────────────────────────
-- RLS is INERT until the app connects as the non-BYPASSRLS app_tenant role
-- (Phase E1). The only effect that bites immediately under neondb_owner is the
-- loud-fail DEFAULT (1). It is therefore safe ONLY because every INSERT writer
-- to these tables now stamps organization_id (explicitly or via a parent
-- subquery / GUC). Audited + threaded 2026-06-19:
--   receiving         — lookup-po (upsertMatched/Unmatched/Test), receiving-entry,
--                       zoho/purchase-orders/receive, zoho-receiving-sync (USAV),
--                       sourcing-queries, attach-box ensureReceivingForPo.
--                       (neon/receiving-queries = dead code, 0 callers.)
--   receiving_lines   — receiving-lines/route, add-unmatched-line, lookup-po,
--                       zoho/purchase-orders/receive, zoho-receiving-sync (USAV).
--   receiving_scans   — record-scan (derives org from parent receiving subquery).
--   receiving_shipments — attach-box (stamps org).
--   receiving_line_views — receiving-lines/view (stamps org).
-- All five already have organization_id NOT NULL, so the loud-fail default is
-- the intended backstop, not a data-migration risk.
--
-- ROLLBACK: select relax_tenant_isolation('<table>') restores NO FORCE + the
-- transitional USAV-fallback default.
--
-- Idempotent: enforce_tenant_isolation uses create-or-replace / drop-if-exists
-- internally; the DO-block skips any table absent in this DB.
-- ============================================================================

DO $$
DECLARE
  t text;
  core_tables text[] := ARRAY[
    'receiving',
    'receiving_lines',
    'receiving_scans',
    'receiving_shipments',
    'receiving_line_views'
  ];
  table_exists boolean;
BEGIN
  FOREACH t IN ARRAY core_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables '
      'WHERE table_schema = ''public'' AND table_name = %L)', t
    ) INTO table_exists;

    IF NOT table_exists THEN
      RAISE NOTICE 'enforce_tenant_isolation: skipping % (absent in this DB)', t;
      CONTINUE;
    END IF;

    PERFORM enforce_tenant_isolation(t::regclass);
    RAISE NOTICE 'enforce_tenant_isolation: FORCED tenant isolation on %', t;
  END LOOP;
END $$;
