-- ============================================================================
-- 2026-07-08g_backfill_pack_profiles_from_rules.sql
--
-- Best-effort backfill: create SKU_CATALOG pack_profile_links for existing
-- sku_catalog rows that do not yet have an override link.
--
-- This intentionally does NOT add columns to sku_catalog.
--
-- Notes:
-- - We only seed MEDIUM defaults (13 min) as a safe baseline; the more nuanced
--   rules live in code and can be applied at enrichment time without creating
--   a permanent override for every SKU.
-- - Operators can set explicit packTier/estimatedPackMinutes via SKU catalog
--   API which writes pack_profile_links.
--
-- This migration is additive + idempotent.
-- ============================================================================

BEGIN;

-- Seed capacity rows for orgs that have none (safe defaults).
INSERT INTO org_pack_capacity (organization_id)
SELECT DISTINCT sc.organization_id
FROM sku_catalog sc
WHERE sc.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM org_pack_capacity opc WHERE opc.organization_id = sc.organization_id
  );

-- Backfill links only for SKUs with no existing link.
-- We seed a default MEDIUM profile (13 minutes) to enable immediate KPI weighting
-- even before rule-based enrichment fills in more accurate tiers.
WITH missing AS (
  SELECT sc.organization_id, sc.id AS sku_catalog_id
  FROM sku_catalog sc
  WHERE sc.organization_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pack_profile_links l
      WHERE l.organization_id = sc.organization_id
        AND l.owner_type = 'SKU_CATALOG'
        AND l.owner_id = sc.id
    )
),
new_profiles AS (
  INSERT INTO pack_profiles (organization_id, pack_tier, estimated_minutes, source)
  SELECT m.organization_id, 'MEDIUM', 13, 'rules'
  FROM missing m
  RETURNING id, organization_id
),
paired AS (
  SELECT
    m.organization_id,
    m.sku_catalog_id,
    np.id AS pack_profile_id,
    row_number() OVER (PARTITION BY m.organization_id ORDER BY np.id) AS rn
  FROM missing m
  JOIN new_profiles np ON np.organization_id = m.organization_id
),
missing_ranked AS (
  SELECT
    m.organization_id,
    m.sku_catalog_id,
    row_number() OVER (PARTITION BY m.organization_id ORDER BY m.sku_catalog_id) AS rn
  FROM missing m
)
INSERT INTO pack_profile_links (organization_id, owner_type, owner_id, pack_profile_id)
SELECT
  mr.organization_id,
  'SKU_CATALOG',
  mr.sku_catalog_id,
  p.pack_profile_id
FROM missing_ranked mr
JOIN paired p
  ON p.organization_id = mr.organization_id
 AND p.rn = mr.rn
ON CONFLICT (organization_id, owner_type, owner_id) DO NOTHING;

COMMIT;

