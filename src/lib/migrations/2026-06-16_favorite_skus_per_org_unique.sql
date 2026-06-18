-- ============================================================================
-- 2026-06-16_favorite_skus_per_org_unique.sql
--
-- Tenant-isolation slice (favorite_skus) — correctness, SAFE TO APPLY NOW.
--
-- favorite_skus was created with `sku_normalized VARCHAR(255) NOT NULL UNIQUE`
-- — a GLOBAL unique. Two tenants legitimately favorite the same SKU; the
-- global unique would reject the second org's row. The tenant-scoped natural
-- key is (organization_id, sku_normalized).
--
-- Idempotent. Single-tenant today, so the composite cannot collide on backfill.
-- (favorite_sku_workspaces needs no fix: its PK (favorite_id, workspace_key)
-- is already org-safe via the FK to favorite_skus.)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'favorite_skus'::regclass
      AND conname = 'favorite_skus_sku_normalized_key'
  ) THEN
    ALTER TABLE favorite_skus DROP CONSTRAINT favorite_skus_sku_normalized_key;
    RAISE NOTICE 'dropped global unique favorite_skus_sku_normalized_key';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'favorite_skus'::regclass
      AND conname = 'favorite_skus_org_sku_key'
  ) THEN
    ALTER TABLE favorite_skus
      ADD CONSTRAINT favorite_skus_org_sku_key UNIQUE (organization_id, sku_normalized);
    RAISE NOTICE 'added per-org unique favorite_skus_org_sku_key (organization_id, sku_normalized)';
  END IF;
END $$;
