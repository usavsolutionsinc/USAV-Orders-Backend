-- ─────────────────────────────────────────────────────────────────────────────
-- fba_fnskus — phase 1 (EXPAND): add UNIQUE(organization_id, fnsku) ALONGSIDE
-- the existing PRIMARY KEY(fnsku). NON-BREAKING, safe to apply anytime.
-- ─────────────────────────────────────────────────────────────────────────────
-- Mirrors the sku_catalog expand/contract pattern in
-- 2026-06-28j_sku_catalog_add_composite_unique.sql. The app upserts now conflict
-- on (organization_id, fnsku) (8 code sites flipped from ON CONFLICT (fnsku)),
-- which needs a unique constraint on (organization_id, fnsku) to EXIST. We add
-- it here WITHOUT touching the PRIMARY KEY(fnsku), so during the rollout window:
--   • deployed OLD code (ON CONFLICT (fnsku)) keeps working — the PK is intact;
--   • newly-deployed code (ON CONFLICT (organization_id, fnsku)) works — composite present.
-- Both coexist harmlessly. The PK is swapped to (organization_id, fnsku) later in
-- phase 2 (the .gated contract migration) AFTER the new code is live everywhere.
--
-- Safe on current data: organization_id is NOT NULL on fba_fnskus and the
-- deployment is single-tenant, so (organization_id, fnsku) is already unique —
-- adding the constraint cannot fail. The 4 child FKs that reference fba_fnskus
-- still hang off the existing PK and are untouched here.
--
-- Apply order: run this (with `npm run db:migrate`) BEFORE/with deploying the
-- ON CONFLICT (organization_id, fnsku) code. Then deploy, then apply the phase-2
-- PK swap (2026-06-14_fba_fnskus_composite_pk.sql.gated).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'fba_fnskus'::regclass AND conname = 'fba_fnskus_org_fnsku_key'
  ) THEN
    ALTER TABLE fba_fnskus
      ADD CONSTRAINT fba_fnskus_org_fnsku_key UNIQUE (organization_id, fnsku);
  END IF;
END $$;
