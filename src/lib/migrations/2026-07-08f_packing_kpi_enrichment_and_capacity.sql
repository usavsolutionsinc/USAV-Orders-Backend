-- ============================================================================
-- 2026-07-08f_packing_kpi_enrichment_and_capacity.sql
--
-- Adds:
--   1) KPI fields to packer_log_enrichment for weighted packing analytics
--   2) org_pack_capacity config table (org-scoped)
--
-- This migration is additive + idempotent.
--
-- Tenant safety:
-- - org_pack_capacity is org-from-birth and FORCE-RLS protected.
-- - packer_log_enrichment is already org-from-birth and RLS-armed; we only add
--   columns and supporting indexes.
--
-- Rollback:
-- - ALTER TABLE packer_log_enrichment DROP COLUMN ... (as needed)
-- - DROP TABLE org_pack_capacity;
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) packer_log_enrichment KPI columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE packer_log_enrichment
  ADD COLUMN IF NOT EXISTS pack_tier text;

ALTER TABLE packer_log_enrichment
  ADD COLUMN IF NOT EXISTS estimated_pack_minutes integer;

ALTER TABLE packer_log_enrichment
  ADD COLUMN IF NOT EXISTS resolved_sku text;

ALTER TABLE packer_log_enrichment
  ADD COLUMN IF NOT EXISTS sku_catalog_id integer;

ALTER TABLE packer_log_enrichment
  ADD COLUMN IF NOT EXISTS tier_source text;

DO $$
BEGIN
  IF to_regclass('public.packer_log_enrichment') IS NOT NULL THEN
    BEGIN
      ALTER TABLE packer_log_enrichment
        ADD CONSTRAINT packer_log_enrichment_pack_tier_check
        CHECK (pack_tier IS NULL OR pack_tier IN ('SMALL','MEDIUM','LARGE'));
    EXCEPTION WHEN duplicate_object THEN
      -- ok
    END;
    BEGIN
      ALTER TABLE packer_log_enrichment
        ADD CONSTRAINT packer_log_enrichment_estimated_pack_minutes_check
        CHECK (estimated_pack_minutes IS NULL OR estimated_pack_minutes >= 0);
    EXCEPTION WHEN duplicate_object THEN
      -- ok
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_packer_log_enrichment_pack_tier
  ON packer_log_enrichment (organization_id, pack_tier)
  WHERE pack_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_packer_log_enrichment_sku_catalog
  ON packer_log_enrichment (organization_id, sku_catalog_id)
  WHERE sku_catalog_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) org_pack_capacity (org-scoped config)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_pack_capacity (
  id                  bigserial PRIMARY KEY,
  organization_id     uuid NOT NULL,
  packer_headcount    integer NOT NULL DEFAULT 2,
  workday_minutes     integer NOT NULL DEFAULT 480,
  daily_medium_target integer NOT NULL DEFAULT 60,
  daily_large_target  integer NOT NULL DEFAULT 16,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_pack_capacity_headcount_check CHECK (packer_headcount >= 0),
  CONSTRAINT org_pack_capacity_workday_minutes_check CHECK (workday_minutes >= 0),
  CONSTRAINT org_pack_capacity_daily_medium_target_check CHECK (daily_medium_target >= 0),
  CONSTRAINT org_pack_capacity_daily_large_target_check CHECK (daily_large_target >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_org_pack_capacity_org
  ON org_pack_capacity (organization_id);

COMMENT ON TABLE org_pack_capacity IS
  'Org-scoped packing capacity defaults for KPI weighting and slack calculations.';

DO $$
BEGIN
  IF to_regclass('public.org_pack_capacity') IS NOT NULL THEN
    PERFORM enforce_tenant_isolation('org_pack_capacity');
  END IF;
END $$;

COMMIT;

