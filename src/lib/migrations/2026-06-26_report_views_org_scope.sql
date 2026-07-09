-- ============================================================================
-- 2026-06-26: Org-scope the reporting materialized views  (BUG-0015)
-- ============================================================================
-- The three report MVs (2026-05-14_report_views.sql) aggregate ACROSS ALL
-- TENANTS — they carry no organization_id. velocity/dead-stock routes defended
-- by re-joining org from base tables, but that is fragile (bin-utilization
-- missed it and leaked every tenant's bin layout). This migration rebuilds the
-- three MVs with organization_id as a first-class column + GROUP BY key so the
-- report routes can filter the MV directly.
--
-- Tenant-isolation note: the sku-keyed MVs (velocity, dead_stock) are now keyed
-- on (organization_id, sku) — `sku` alone is NOT unique across tenants (the two
-- SKU numbering schemes collide; see .claude/rules/source-of-truth.md). The
-- unique index MUST include organization_id or the nightly
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` (cron/refresh-reports) breaks.
--
-- APPLY OFF-PEAK: CREATE MATERIALIZED VIEW populates inline by scanning
-- sku_stock_ledger inside the migration transaction, so this runs long on a big
-- ledger. It is NON-DESTRUCTIVE (MVs are derived; the nightly cron rebuilds
-- them), but the populate holds the txn open — schedule it in a low-traffic
-- window. Backward-compatible: all prior columns are preserved, so existing
-- report routes keep working; re-scoping them to the MV's own organization_id
-- column is a separate follow-up.
-- ============================================================================

BEGIN;

-- ─── Bin utilization ─────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_bin_utilization;
CREATE MATERIALIZED VIEW mv_bin_utilization AS
  SELECT
    l.organization_id                             AS organization_id,
    l.id                                          AS bin_id,
    l.name                                        AS bin_name,
    l.barcode,
    l.room,
    l.row_label,
    l.col_label,
    l.capacity,
    COALESCE(SUM(bc.qty), 0)::int                 AS in_bin,
    CASE
      WHEN l.capacity IS NOT NULL AND l.capacity > 0
        THEN ROUND((COALESCE(SUM(bc.qty), 0)::numeric / l.capacity::numeric)::numeric, 3)
      ELSE NULL
    END                                           AS fill_ratio,
    COUNT(bc.id) FILTER (WHERE bc.qty > 0)::int   AS sku_count
  FROM locations l
  LEFT JOIN bin_contents bc ON bc.location_id = l.id
  WHERE l.is_active = true
  GROUP BY l.organization_id, l.id, l.name, l.barcode, l.room, l.row_label, l.col_label, l.capacity;

-- bin_id (= locations.id) is globally unique, so it alone satisfies the
-- CONCURRENTLY-refresh unique-index requirement. Add an org index for filtering.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_bin_utilization_pk ON mv_bin_utilization(bin_id);
CREATE INDEX IF NOT EXISTS idx_mv_bin_utilization_org ON mv_bin_utilization(organization_id);

-- ─── SKU velocity (last 30 days) ──────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_sku_velocity_30d;
CREATE MATERIALIZED VIEW mv_sku_velocity_30d AS
  WITH movement AS (
    SELECT
      organization_id,
      sku,
      SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END)::int AS out_qty,
      SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END)::int  AS in_qty,
      MAX(created_at)                                       AS last_move_at
    FROM sku_stock_ledger
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND reason <> 'INITIAL_BALANCE'
    GROUP BY organization_id, sku
  )
  SELECT
    m.organization_id,
    m.sku,
    m.out_qty,
    m.in_qty,
    m.last_move_at,
    ss.stock                                        AS current_stock,
    COALESCE(
      NULLIF(ss.display_name_override, ''),
      sp.display_name,
      sc.product_title,
      NULLIF(ss.product_title, '')
    )                                               AS product_title,
    CASE
      WHEN m.out_qty >= 50 THEN 'A'
      WHEN m.out_qty >= 10 THEN 'B'
      WHEN m.out_qty >  0  THEN 'C'
      ELSE 'D'
    END                                             AS velocity_tier
  FROM movement m
  LEFT JOIN sku_stock ss
    ON ss.sku = m.sku
   AND ss.organization_id = m.organization_id
  LEFT JOIN sku_catalog sc
    ON sc.sku = m.sku
   AND sc.organization_id = m.organization_id
  LEFT JOIN LATERAL (
    SELECT e.display_name FROM sku_platform_ids e
    WHERE e.sku_catalog_id = sc.id
      AND e.organization_id = sc.organization_id
      AND e.platform = 'ecwid' AND e.is_active = true
      AND e.display_name IS NOT NULL
    LIMIT 1
  ) sp ON TRUE;

-- Unique key MUST include organization_id (sku collides across tenants).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sku_velocity_30d_pk
  ON mv_sku_velocity_30d(organization_id, sku);
CREATE INDEX IF NOT EXISTS idx_mv_sku_velocity_30d_tier
  ON mv_sku_velocity_30d(organization_id, velocity_tier, out_qty DESC);

-- ─── Dead stock (no movement in 90 days) ─────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_dead_stock;
CREATE MATERIALIZED VIEW mv_dead_stock AS
  WITH last_move AS (
    SELECT organization_id, sku, MAX(created_at) AS last_move_at
    FROM sku_stock_ledger
    WHERE reason <> 'INITIAL_BALANCE'
    GROUP BY organization_id, sku
  )
  SELECT
    ss.organization_id,
    ss.sku,
    ss.stock,
    lm.last_move_at,
    COALESCE(
      NULLIF(ss.display_name_override, ''),
      sp.display_name,
      sc.product_title,
      NULLIF(ss.product_title, '')
    )                                               AS product_title,
    -- NULL when the SKU has no movement events on record — the endpoint
    -- treats those as "never moved" and surfaces them under a separate filter.
    CASE
      WHEN lm.last_move_at IS NULL THEN NULL::int
      ELSE EXTRACT(DAY FROM (NOW() - lm.last_move_at))::int
    END                                             AS days_dormant
  FROM sku_stock ss
  LEFT JOIN last_move lm
    ON lm.sku = ss.sku
   AND lm.organization_id = ss.organization_id
  LEFT JOIN sku_catalog sc
    ON sc.sku = ss.sku
   AND sc.organization_id = ss.organization_id
  LEFT JOIN LATERAL (
    SELECT e.display_name FROM sku_platform_ids e
    WHERE e.sku_catalog_id = sc.id
      AND e.organization_id = sc.organization_id
      AND e.platform = 'ecwid' AND e.is_active = true
      AND e.display_name IS NOT NULL
    LIMIT 1
  ) sp ON TRUE
  WHERE ss.stock > 0
    AND (lm.last_move_at IS NULL OR lm.last_move_at < NOW() - INTERVAL '90 days');

-- Unique key MUST include organization_id (sku collides across tenants).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dead_stock_pk
  ON mv_dead_stock(organization_id, sku);
CREATE INDEX IF NOT EXISTS idx_mv_dead_stock_dormant
  ON mv_dead_stock(organization_id, days_dormant DESC NULLS LAST);

COMMIT;
