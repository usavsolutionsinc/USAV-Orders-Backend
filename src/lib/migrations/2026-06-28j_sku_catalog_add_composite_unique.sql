-- ─────────────────────────────────────────────────────────────────────────────
-- H4 — phase 1 (EXPAND): add the per-org UNIQUE(organization_id, sku) ALONGSIDE
-- the existing global UNIQUE(sku). NON-BREAKING and safe to apply anytime.
-- ─────────────────────────────────────────────────────────────────────────────
-- Why two phases: the app upserts conflict on (organization_id, sku) as of the
-- H4 code change, which needs this composite constraint to EXIST. We add it here
-- WITHOUT dropping the old UNIQUE(sku), so:
--   • deployed OLD code (ON CONFLICT (sku)) keeps working — sku-unique still present;
--   • newly-deployed code (ON CONFLICT (organization_id, sku)) works — composite present.
-- Both constraints coexist harmlessly during the rollout window. The old
-- UNIQUE(sku) is dropped in phase 2 (the .gated contract migration) AFTER the
-- new code is live everywhere.
--
-- Safe on current data: organization_id is NOT NULL and every row carries a real
-- org (verified 0 NULL-org rows), and the deployment is single-tenant, so
-- (organization_id, sku) is already unique — adding the constraint cannot fail.
-- PK is unaffected: every FK references sku_catalog.id (serial), never sku.
--
-- Apply order: run this (with your normal `npm run db:migrate`) BEFORE deploying
-- the `ON CONFLICT (organization_id, sku)` code. Then deploy, then apply the
-- phase-2 drop (2026-06-14_sku_catalog_composite_unique.sql.gated).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sku_catalog'::regclass AND conname = 'sku_catalog_org_sku_key'
  ) THEN
    ALTER TABLE sku_catalog
      ADD CONSTRAINT sku_catalog_org_sku_key UNIQUE (organization_id, sku);
  END IF;
END $$;
