-- ============================================================================
-- 2026-07-08_sku_stock_drift_org_aware.sql
--
-- WHAT: Replace global v_sku_stock_drift and fn_reconcile_sku_stock() with
--       org-scoped versions keyed on (organization_id, sku).
--
-- WHY: The pre-tenant view aggregated ledger rows by bare sku, so drift
--       detection and reconcile could mix tenants once org #2 lands.
--
-- SAFETY: CREATE OR REPLACE view + function. Drift-check cron already joins
--         per-org; this aligns SQL ad-hoc checks with app logic.
--
-- ROLLBACK: Re-apply view + fn from 2026-04-15_sku_stock_ledger_authoritative.sql.
--
-- VERIFY: SELECT * FROM v_sku_stock_drift d
--           JOIN sku_stock ss USING (organization_id, sku)
--         WHERE ss.organization_id = '<org-uuid>';
--         — should match per-org ledger sums only.
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS v_sku_stock_drift;

CREATE VIEW v_sku_stock_drift AS
WITH ledger_sums AS (
  SELECT
    organization_id,
    sku,
    COALESCE(SUM(CASE WHEN dimension = 'WAREHOUSE' THEN delta ELSE 0 END), 0)::int AS warehouse_sum,
    COALESCE(SUM(CASE WHEN dimension = 'BOXED'     THEN delta ELSE 0 END), 0)::int AS boxed_sum
  FROM sku_stock_ledger
  GROUP BY organization_id, sku
)
SELECT
  s.organization_id,
  s.sku,
  s.stock                                            AS stored_stock,
  COALESCE(ls.warehouse_sum, 0)                      AS ledger_warehouse,
  (s.stock - COALESCE(ls.warehouse_sum, 0))          AS warehouse_drift,
  s.boxed_stock                                      AS stored_boxed,
  COALESCE(ls.boxed_sum, 0)                          AS ledger_boxed,
  (s.boxed_stock - COALESCE(ls.boxed_sum, 0))        AS boxed_drift
FROM sku_stock s
LEFT JOIN ledger_sums ls
  ON ls.sku = s.sku AND ls.organization_id = s.organization_id
WHERE s.stock       <> COALESCE(ls.warehouse_sum, 0)
   OR s.boxed_stock <> COALESCE(ls.boxed_sum, 0);

COMMENT ON VIEW v_sku_stock_drift IS
  'Per-org SKUs where stored counters disagree with ledger dimension sums. Should be empty per tenant. Non-empty = a writer bypassed the ledger.';

CREATE OR REPLACE FUNCTION fn_reconcile_sku_stock(p_org_id UUID DEFAULT NULL)
RETURNS TABLE (
  organization_id UUID,
  sku             TEXT,
  was_warehouse   INTEGER,
  now_warehouse   INTEGER,
  was_boxed       INTEGER,
  now_boxed       INTEGER
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH computed AS (
    SELECT
      l.organization_id AS org_id,
      l.sku AS s,
      COALESCE(SUM(CASE WHEN l.dimension = 'WAREHOUSE' THEN l.delta ELSE 0 END), 0)::int AS wh,
      COALESCE(SUM(CASE WHEN l.dimension = 'BOXED'     THEN l.delta ELSE 0 END), 0)::int AS bx
    FROM sku_stock_ledger l
    WHERE p_org_id IS NULL OR l.organization_id = p_org_id
    GROUP BY l.organization_id, l.sku
  ),
  before AS (
    SELECT ss.organization_id AS org_id, ss.sku AS s, ss.stock AS old_wh, ss.boxed_stock AS old_bx
    FROM sku_stock ss
    JOIN computed c ON c.s = ss.sku AND c.org_id = ss.organization_id
    WHERE ss.stock <> c.wh OR ss.boxed_stock <> c.bx
  ),
  upd AS (
    UPDATE sku_stock ss
    SET stock       = c.wh,
        boxed_stock = c.bx,
        updated_at  = NOW()
    FROM computed c
    WHERE ss.sku = c.s AND ss.organization_id = c.org_id
      AND (ss.stock <> c.wh OR ss.boxed_stock <> c.bx)
    RETURNING ss.organization_id AS org_id, ss.sku AS s, ss.stock AS new_wh, ss.boxed_stock AS new_bx
  )
  SELECT b.org_id, b.s, b.old_wh, u.new_wh, b.old_bx, u.new_bx
  FROM before b
  JOIN upd u ON u.org_id = b.org_id AND u.s = b.s;
END;
$$;

COMMENT ON FUNCTION fn_reconcile_sku_stock(UUID) IS
  'Replay ledger sums into sku_stock for drifted rows. Optional p_org_id scopes to one tenant.';

COMMIT;
