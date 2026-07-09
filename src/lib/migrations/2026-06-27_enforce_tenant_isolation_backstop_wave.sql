-- ============================================================================
-- 2026-06-27_enforce_tenant_isolation_backstop_wave.sql
--
-- Bucket-1 backstop wave: FORCE RLS + tenant_isolation policy + loud-fail default
-- on tenant-owned tables that currently have an organization_id column but NO RLS
-- enforcement (so isolation depended only on app-layer filters). Each table below
-- was verified (2026-06-27 leak audit, docs/tenancy/leak-audit-2026-06-27.md +
-- docs/tenancy/route-scoping-audit.generated.md reverse index) to be safe to FORCE
-- NOW because EVERY route/writer touching it is already GUC-scoped (tenantQuery /
-- withTenantTransaction), so FORCE only tightens reads — it cannot break a writer:
--
--   rag_documents            — 1 route,  0 not-GUC-safe
--   rag_document_chunks      — 2 routes, 0 not-GUC-safe
--   sku_relationships        — 1 route,  0 not-GUC-safe
--   station_definitions      — 4 routes, 0 not-GUC-safe
--   email_delivery_signals   — 2 routes, 0 not-GUC-safe
--   integration_credential_audit — writer-only (credential-scope.ts threads org)
--   billing_subscriptions    — writer-only (billing/subscriptions.ts: WHERE org)
--   warranty_quotes          — writer-only (warranty lib threads org; loud-fail dflt already)
--   warranty_claim_events    — writer-only (child of warranty_claims via warranty lib)
--   warranty_repair_attempts — writer-only (warranty lib threads org)
--
-- `enforce_tenant_isolation(t)` (existing helper) does ENABLE + FORCE ROW LEVEL
-- SECURITY + the tenant_isolation policy + swaps the column default to the
-- loud-fail enforce_tenant_isolation() expression, idempotently. Each table is
-- wrapped so one problematic table is logged + skipped, never aborting the wave.
-- Revert a single table with: SELECT relax_tenant_isolation('<table>');
--
-- PRE-APPLY GATE: run `npm run tenancy:guard:check` first — it must report no
-- raw-pool route touching any table below. (All were 0-⛔ at authoring time.)
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rag_documents',
    'rag_document_chunks',
    'sku_relationships',
    'station_definitions',
    'email_delivery_signals',
    'integration_credential_audit',
    'billing_subscriptions',
    'warranty_quotes',
    'warranty_claim_events',
    'warranty_repair_attempts'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
