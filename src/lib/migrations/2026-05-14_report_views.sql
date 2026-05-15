-- ============================================================================
-- 2026-05-14: Reporting materialized views
-- ============================================================================
-- Three views power the /reports page:
--   mv_bin_utilization — capacity vs current fill per bin
--   mv_sku_velocity_30d — outbound + inbound movement over last 30 days
--   mv_dead_stock — SKUs with stock but no movement in 90 days
--
-- Refreshed nightly via /api/cron/refresh-reports.
-- ============================================================================

BEGIN;

-- ─── Bin utilization ─────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_bin_utilization;
CREATE MATERIALIZED VIEW mv_bin_utilization AS
  SELECT
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
  GROUP BY l.id, l.name, l.barcode, l.room, l.row_label, l.col_label, l.capacity;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_bin_utilization_pk ON mv_bin_utilization(bin_id);

-- ─── SKU velocity (last 30 days) ──────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_sku_velocity_30d;
CREATE MATERIALIZED VIEW mv_sku_velocity_30d AS
  WITH movement AS (
    SELECT
      sku,
      SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END)::int AS out_qty,
      SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END)::int  AS in_qty,
      MAX(created_at)                                       AS last_move_at
    FROM sku_stock_ledger
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND reason <> 'INITIAL_BALANCE'
    GROUP BY sku
  )
  SELECT
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
  LEFT JOIN sku_stock ss ON ss.sku = m.sku
  LEFT JOIN sku_catalog sc ON sc.sku = m.sku
  LEFT JOIN LATERAL (
    SELECT e.display_name FROM sku_platform_ids e
    WHERE e.sku_catalog_id = sc.id
      AND e.platform = 'ecwid' AND e.is_active = true
      AND e.display_name IS NOT NULL
    LIMIT 1
  ) sp ON TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sku_velocity_30d_pk
  ON mv_sku_velocity_30d(sku);
CREATE INDEX IF NOT EXISTS idx_mv_sku_velocity_30d_tier
  ON mv_sku_velocity_30d(velocity_tier, out_qty DESC);

-- ─── Dead stock (no movement in 90 days) ─────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_dead_stock;
CREATE MATERIALIZED VIEW mv_dead_stock AS
  WITH last_move AS (
    SELECT sku, MAX(created_at) AS last_move_at
    FROM sku_stock_ledger
    WHERE reason <> 'INITIAL_BALANCE'
    GROUP BY sku
  )
  SELECT
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
  LEFT JOIN last_move lm ON lm.sku = ss.sku
  LEFT JOIN sku_catalog sc ON sc.sku = ss.sku
  LEFT JOIN LATERAL (
    SELECT e.display_name FROM sku_platform_ids e
    WHERE e.sku_catalog_id = sc.id
      AND e.platform = 'ecwid' AND e.is_active = true
      AND e.display_name IS NOT NULL
    LIMIT 1
  ) sp ON TRUE
  WHERE ss.stock > 0
    AND (lm.last_move_at IS NULL OR lm.last_move_at < NOW() - INTERVAL '90 days');

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dead_stock_pk ON mv_dead_stock(sku);
CREATE INDEX IF NOT EXISTS idx_mv_dead_stock_dormant
  ON mv_dead_stock(days_dormant DESC NULLS LAST);

COMMIT;
