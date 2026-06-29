-- ============================================================================
-- 2026-06-28_enforce_tenant_isolation_business_tail.sql
--
-- E2 final business tail: FORCE RLS + tenant_isolation policy + loud-fail default
-- on the last genuine tenant-owned business tables that still had an
-- organization_id column but no FORCE. Verified 2026-06-28 (live probe +
-- route/pool inventory) that EVERY path touching each table is either
-- GUC-scoped (tenantQuery / withTenant*) or runs on the privileged owner pool
-- (which bypasses RLS, so FORCE only tightens — it cannot break a writer):
--
--   photo_exports              — 0 rows; sibling photo_* tables already FORCEd;
--                                org NOT NULL. Omission, not a deliberate skip.
--   organization_integrations  — 0 rows; org NOT NULL. ALL access is owner-pool
--                                (credentials.ts / connectors/orchestrator.ts
--                                cross-org `SELECT DISTINCT organization_id` /
--                                connections.ts / credential-scope.ts), so the
--                                cross-org enumeration survives FORCE via bypass.
--                                FORCE is defense-in-depth for any future
--                                tenant-pool reader of the credential vault.
--
-- The remaining genuine-business set below is re-affirmed idempotently (a no-op
-- where already FORCEd) so the live state and the codebase agree regardless of
-- which prior wave first enforced each.
--
-- `enforce_tenant_isolation(t)` (existing helper) does ENABLE + FORCE ROW LEVEL
-- SECURITY + the tenant_isolation policy + the loud-fail column default,
-- idempotently. Per-table EXCEPTION handling: one bad table logs + is skipped,
-- never aborting the wave. Revert one table with: SELECT relax_tenant_isolation('<t>').
--
-- DELIBERATELY NOT FORCED (by design, do not add here):
--   Global reference  — bose_models, bose_serial_prefixes, failure_modes,
--                       part_compatibility, return_dispositions
--   Global STN        — shipping_tracking_numbers, shipment_tracking_events
--   External / system — hermes_*, training_runs, audit_logs, stripe_events,
--                       order_ingest_queue
--   Identity / HR (Phase F) — staff, staff_sessions, email_login_tokens,
--                       accounts/memberships/organizations/roles/payroll/shifts
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'photo_exports',
    'organization_integrations',
    -- idempotent re-affirm of the genuine-business set (no-op where already FORCEd):
    'warranty_claims',
    'amazon_accounts',
    'voicemails',
    'photo_analysis',
    'photo_entity_links',
    'photo_jobs',
    'photo_storage',
    'zoho_fulfillment_sync',
    'email_missing_purchase_orders'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'business_tail: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'business_tail: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'business_tail: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
