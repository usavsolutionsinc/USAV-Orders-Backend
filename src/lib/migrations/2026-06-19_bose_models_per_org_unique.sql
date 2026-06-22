-- ============================================================================
-- 2026-06-19_bose_models_per_org_unique.sql
--
-- Tenant-isolation correctness (bose_models), pairs with the route/helper fix in
-- the 2026-06-19 route-hardening session (docs/tenancy/SESSION-2026-06-19-route-hardening.md).
--
-- bose_models was created with `model_number TEXT NOT NULL UNIQUE` — a GLOBAL
-- natural key. The route classified /api/bose-models a real_leak: upsertBoseModel
-- used `INSERT ... ON CONFLICT (model_number) DO UPDATE`, so a second tenant
-- creating an already-used model number would CLOBBER the first tenant's catalog
-- row. The natural key for a tenant-scoped table is (organization_id, model_number).
--
-- Ordering safety: the helper (src/lib/neon/bose-model-queries.ts) was rewritten
-- in the same change to use an org-scoped SELECT-then-INSERT/UPDATE instead of
-- ON CONFLICT, so it no longer depends on WHICH unique exists. That means this
-- migration is safe to apply before OR after the code deploys (no broken window),
-- unlike a migration coupled to an ON CONFLICT target.
--
-- Pure correctness — SAFE TO APPLY NOW. Does NOT enable FORCE/RLS (that is the
-- gated .sql.template step, blocked on E1). Idempotent. organization_id already
-- exists on bose_models (added 2026-06-14_org_id_phase_b_needs_col_2.sql) and is
-- USAV-backfilled, so the composite unique cannot collide on the single tenant.
-- ============================================================================

DO $$
BEGIN
  -- Drop the implicit global unique (column-level UNIQUE in CREATE TABLE is named
  -- <table>_<col>_key). Guarded so re-runs are no-ops.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bose_models'::regclass
      AND conname = 'bose_models_model_number_key'
  ) THEN
    ALTER TABLE bose_models DROP CONSTRAINT bose_models_model_number_key CASCADE;
    RAISE NOTICE 'dropped global unique bose_models_model_number_key (CASCADE)';
  END IF;

  -- Add the tenant-scoped natural key. The POST /api/bose-models 409-on-dup path
  -- keys on the 23505 unique violation, which still fires for a duplicate model
  -- number WITHIN the same org.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bose_models'::regclass
      AND conname = 'bose_models_org_model_number_key'
  ) THEN
    ALTER TABLE bose_models
      ADD CONSTRAINT bose_models_org_model_number_key UNIQUE (organization_id, model_number);
    RAISE NOTICE 'added per-org unique bose_models_org_model_number_key (organization_id, model_number)';
  END IF;
END $$;
