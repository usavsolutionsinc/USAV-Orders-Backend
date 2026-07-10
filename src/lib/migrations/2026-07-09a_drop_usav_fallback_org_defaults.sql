-- ============================================================================
-- 2026-07-09a_drop_usav_fallback_org_defaults.sql
--
-- Wave 2a / 6b: drop the LAST 8 USAV-fallback organization_id DEFAULTs.
-- Replaces the transitional default
--   COALESCE(NULLIF(current_setting('app.current_org', true), '')::uuid, USAV)
-- with the canonical loud-fail GUC default that enforce_tenant_isolation()
-- installs (2026-06-14_rls_enforcement_infra.sql):
--   NULLIF(current_setting('app.current_org', true), '')::uuid
-- After this, an INSERT that neither stamps organization_id nor runs under
-- withTenantConnection/withTenantTransaction lands NULL (or NOT-NULL-fails)
-- instead of silently filing the row under the USAV tenant — the exact
-- cross-tenant footgun docs/tenancy/org-id-coverage.generated.md flags
-- ("still on USAV-fallback default: 8").
--
-- Scope: DEFAULT flip ONLY. No FORCE/policy changes — the 5 reference-decide
-- tables (bose_models, bose_serial_prefixes, failure_modes,
-- part_compatibility, return_dispositions) keep their current RLS state
-- pending the Phase B1 global-vs-tenant decision; the 3 tenant-owned ones
-- (shipment_tracking_events, shipping_tracking_numbers, training_runs) are
-- already FORCEd with a tenant_isolation policy.
--
-- ⚠ DEPLOY COUPLING — DO NOT APPLY BEFORE the webhook org-resolution code:
--   The carrier webhooks are the writers that leaned on this DEFAULT.
--   createOrGetShipment() in src/lib/shipping/repository.ts keeps a
--   deliberate "byte-identical raw-pool path" when orgId is omitted
--   (session-less carrier-webhook callers): today those INSERTs stamp USAV
--   via the fallback default; after this migration they land
--   organization_id = NULL. This file must ship in the SAME deploy as (or
--   after) the webhook org-resolution change that threads orgId into that
--   path — never before it.
--
-- WRITER AUDIT (grep of INSERTs across src/, 2026-07-09):
--   bose_models              src/lib/neon/bose-model-queries.ts — stamps
--                            organization_id explicitly ($10, orgId ?? null). Safe.
--   bose_serial_prefixes     no src/ writers (migration-seeded reference). Safe.
--   failure_modes            src/lib/neon/failure-modes-queries.ts
--                            createFailureMode() omitted the column (stale
--                            "NEEDS-COL" comment) — FIXED alongside this file
--                            to stamp organization_id explicitly; sole prod
--                            caller (POST /api/failure-modes) always passes
--                            ctx.organizationId. Safe.
--   part_compatibility       src/lib/neon/part-compatibility-queries.ts —
--                            omits the column; org branch runs under
--                            withTenantTransaction so the GUC default stamps
--                            it. The legacy no-org branch now writes NULL
--                            (column is nullable) instead of USAV — visible
--                            in coverage, not a crash. Acceptable.
--   return_dispositions      src/lib/rma/authorizations.ts recordDisposition()
--                            — omits the column; org path GUC-stamps via
--                            withTenantTransaction; legacy session-less path
--                            now writes NULL (nullable). Acceptable.
--   shipment_tracking_events src/lib/shipping/repository.ts — copies
--                            organization_id from the parent
--                            shipping_tracking_numbers row via subselect;
--                            GUC-independent. Safe.
--   shipping_tracking_numbers src/lib/shipping/repository.ts (org branch
--                            explicit; no-org branch = the webhook-coupled
--                            writer above), src/lib/neon/orders-tracking-queries.ts
--                            and the 3 FBA shipment routes all stamp
--                            ctx.organizationId explicitly. Safe once the
--                            webhook coupling lands.
--   training_runs            organization_id is NOT NULL — no src/ writers.
--                            scripts/e2e-pipeline.mjs (dev/test only) inserts
--                            without org or GUC and will NOT-NULL-fail after
--                            this migration until it sets app.current_org or
--                            stamps organization_id. Known, non-prod.
--
-- ROLLBACK (per table — do NOT use relax_tenant_isolation here; it would also
-- un-FORCE the 3 forced tables):
--   ALTER TABLE <t> ALTER COLUMN organization_id SET DEFAULT
--     COALESCE(NULLIF(current_setting('app.current_org', true), '')::uuid,
--              '00000000-0000-0000-0000-000000000001'::uuid);
--
-- VERIFY: node scripts/tenancy-coverage.mjs → "still on USAV-fallback default"
-- drops 8 → 0; no table gains/loses FORCE or policies.
--
-- Idempotent: guarded on the USAV literal still being present in the column
-- default; re-runs and fresh DBs (where the tables may not exist yet) no-op.
-- Per-table fault isolation: one failure is caught + logged, others proceed.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  t text;
  v_default text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bose_models', 'bose_serial_prefixes', 'failure_modes', 'part_compatibility',
    'return_dispositions', 'shipment_tracking_events', 'shipping_tracking_numbers',
    'training_runs'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'default_drop: skip % (does not exist)', t; CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.' || t)
        AND attname = 'organization_id' AND NOT attisdropped
    ) THEN
      RAISE NOTICE 'default_drop: skip % (no organization_id column)', t; CONTINUE;
    END IF;

    SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO v_default
    FROM pg_attribute a
    JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = to_regclass('public.' || t)
      AND a.attname = 'organization_id' AND NOT a.attisdropped;

    IF v_default IS NULL
       OR v_default NOT ILIKE '%00000000-0000-0000-0000-000000000001%' THEN
      RAISE NOTICE 'default_drop: skip % (default already non-USAV: %)', t, COALESCE(v_default, '<none>');
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT '
        'nullif(current_setting(''app.current_org'', true), '''')::uuid', t);
      RAISE NOTICE 'default_drop: % → loud-fail GUC default', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'default_drop: alter(%) failed: % — left on USAV fallback', t, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;
