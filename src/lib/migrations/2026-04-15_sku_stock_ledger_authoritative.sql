-- ============================================================================
-- 2026-04-15: Make sku_stock_ledger the source of truth for stock quantities
-- ============================================================================
-- Before: sku_stock.stock was mutated directly by any route (scan-sku,
--         post-multi-sn, PATCH /sku-stock, etc). Drift between stored qty
--         and the ledger sum was silent and unrecoverable.
--
-- After:  sku_stock.stock is a trigger-maintained projection of
--         SUM(sku_stock_ledger.delta) per sku. Writes go to the ledger only.
--         Every delta carries a `reason` + ref_* FK so any quantity change is
--         traceable back to the scan/log/order that caused it.
--
-- What this migration does:
--   1. Normalize sku_stock: UNIQUE(sku), stock → INTEGER, ensure location
--      + updated_at columns exist, NOT NULL + DEFAULT 0 on stock.
--   2. Extend sku_stock_ledger with provenance (ref_*) columns + notes.
--   3. Seed the ledger with one INITIAL_BALANCE row per existing sku_stock
--      row so SUM(delta) already matches current stock before the trigger
--      comes online (prevents the trigger zeroing untouched SKUs).
--   4. Install fn_recompute_sku_stock() + trigger on sku_stock_ledger.
--   5. Provide a reconcile view + function for drift detection.
-- ============================================================================

BEGIN;

-- ─── 1. Normalize sku_stock ────────────────────────────────────────────────

-- De-duplicate before adding UNIQUE(sku): sum any accidental dupes.
WITH dupes AS (
  SELECT MIN(id) AS keep_id,
         sku,
         SUM(NULLIF(regexp_replace(COALESCE(stock::text, '0'), '[^0-9-]', '', 'g'), '')::int) AS total_stock,
         MAX(product_title) AS kept_title
  FROM sku_stock
  WHERE sku IS NOT NULL
  GROUP BY sku
  HAVING COUNT(*) > 1
)
UPDATE sku_stock ss
SET stock = d.total_stock::text,
    product_title = COALESCE(ss.product_title, d.kept_title)
FROM dupes d
WHERE ss.id = d.keep_id;

WITH dupes_to_drop AS (
  SELECT id FROM sku_stock ss
  WHERE EXISTS (
    SELECT 1 FROM sku_stock ss2
    WHERE ss2.sku = ss.sku AND ss2.id < ss.id
  )
)
DELETE FROM sku_stock WHERE id IN (SELECT id FROM dupes_to_drop);

-- Defensive column adds (location is used by PATCH route but not in source schema)
ALTER TABLE sku_stock
  ADD COLUMN IF NOT EXISTS location    TEXT,
  ADD COLUMN IF NOT EXISTS boxed_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN sku_stock.stock       IS 'WAREHOUSE dimension: live on-hand count. Trigger-maintained from sku_stock_ledger.';
COMMENT ON COLUMN sku_stock.boxed_stock IS 'BOXED dimension: units packed + awaiting shipment. Trigger-maintained from sku_stock_ledger.';

-- Coerce stock to INTEGER (was TEXT). Non-numeric rows become 0.
ALTER TABLE sku_stock
  ALTER COLUMN stock TYPE INTEGER
  USING COALESCE(NULLIF(regexp_replace(COALESCE(stock::text, '0'), '[^0-9-]', '', 'g'), '')::int, 0);

ALTER TABLE sku_stock
  ALTER COLUMN stock SET NOT NULL,
  ALTER COLUMN stock SET DEFAULT 0;

-- UNIQUE(sku) enables ON CONFLICT upserts + unambiguous trigger target
CREATE UNIQUE INDEX IF NOT EXISTS sku_stock_sku_key ON sku_stock(sku);

-- ─── 2. Extend sku_stock_ledger with provenance ──────────────────────────

ALTER TABLE sku_stock_ledger
  ADD COLUMN IF NOT EXISTS ref_serial_unit_id      INTEGER,
  ADD COLUMN IF NOT EXISTS ref_packer_log_id       INTEGER,
  ADD COLUMN IF NOT EXISTS ref_tech_log_id         INTEGER,
  ADD COLUMN IF NOT EXISTS ref_sal_id              INTEGER,
  ADD COLUMN IF NOT EXISTS ref_order_id            INTEGER,
  ADD COLUMN IF NOT EXISTS ref_shipment_id         INTEGER,
  ADD COLUMN IF NOT EXISTS ref_receiving_line_id   INTEGER,
  ADD COLUMN IF NOT EXISTS notes                   TEXT,
  -- Which counter this delta affects on sku_stock.
  --   WAREHOUSE = sku_stock.stock       (on-hand shelf inventory)
  --   BOXED     = sku_stock.boxed_stock (packed + awaiting ship)
  ADD COLUMN IF NOT EXISTS dimension               TEXT NOT NULL DEFAULT 'WAREHOUSE';

-- Enforce dimension values (drop-if-exists for replayability)
ALTER TABLE sku_stock_ledger DROP CONSTRAINT IF EXISTS chk_sku_stock_ledger_dimension;
ALTER TABLE sku_stock_ledger
  ADD CONSTRAINT chk_sku_stock_ledger_dimension
  CHECK (dimension IN ('WAREHOUSE', 'BOXED'));

CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_dimension
  ON sku_stock_ledger (sku, dimension);

CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_ref_serial_unit
  ON sku_stock_ledger (ref_serial_unit_id) WHERE ref_serial_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_ref_packer_log
  ON sku_stock_ledger (ref_packer_log_id)  WHERE ref_packer_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_ref_tech_log
  ON sku_stock_ledger (ref_tech_log_id)    WHERE ref_tech_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_ref_order
  ON sku_stock_ledger (ref_order_id)       WHERE ref_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_ref_shipment
  ON sku_stock_ledger (ref_shipment_id)    WHERE ref_shipment_id IS NOT NULL;

COMMENT ON COLUMN sku_stock_ledger.ref_serial_unit_id    IS 'serial_units.id — individual unit that triggered this delta';
COMMENT ON COLUMN sku_stock_ledger.ref_packer_log_id     IS 'packer_logs.id — packing completion that emitted SHIPPED delta';
COMMENT ON COLUMN sku_stock_ledger.ref_tech_log_id       IS 'tech_serial_numbers.id — tech scan that emitted the delta';
COMMENT ON COLUMN sku_stock_ledger.ref_sal_id            IS 'station_activity_logs.id — the scan session that caused this delta';
COMMENT ON COLUMN sku_stock_ledger.ref_order_id          IS 'orders.id — order fulfillment that decremented stock';
COMMENT ON COLUMN sku_stock_ledger.ref_shipment_id       IS 'shipping_tracking_numbers.id — shipment linkage';
COMMENT ON COLUMN sku_stock_ledger.ref_receiving_line_id IS 'receiving_lines.id — inbound PO line that incremented stock';

-- ─── 3. Seed ledger with INITIAL_BALANCE rows (WAREHOUSE dim only) ───────
-- Guard: only seed if no INITIAL_BALANCE exists yet (idempotent).
INSERT INTO sku_stock_ledger (sku, delta, reason, dimension, notes, created_at)
SELECT
  ss.sku,
  ss.stock,
  'INITIAL_BALANCE',
  'WAREHOUSE',
  'Seeded 2026-04-15 during ledger-SoT migration',
  NOW()
FROM sku_stock ss
WHERE ss.sku IS NOT NULL
  AND ss.stock <> 0
  AND NOT EXISTS (
    SELECT 1 FROM sku_stock_ledger l
    WHERE l.sku = ss.sku AND l.reason = 'INITIAL_BALANCE' AND l.dimension = 'WAREHOUSE'
  );

-- Seed existing boxed_stock as INITIAL_BALANCE on BOXED dim (if any).
INSERT INTO sku_stock_ledger (sku, delta, reason, dimension, notes, created_at)
SELECT
  ss.sku,
  ss.boxed_stock,
  'INITIAL_BALANCE',
  'BOXED',
  'Seeded 2026-04-15 during ledger-SoT migration',
  NOW()
FROM sku_stock ss
WHERE ss.sku IS NOT NULL
  AND ss.boxed_stock <> 0
  AND NOT EXISTS (
    SELECT 1 FROM sku_stock_ledger l
    WHERE l.sku = ss.sku AND l.reason = 'INITIAL_BALANCE' AND l.dimension = 'BOXED'
  );

-- ─── 4. Trigger: sku_stock.stock = SUM(sku_stock_ledger.delta) per sku ───

CREATE OR REPLACE FUNCTION fn_recompute_sku_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_sku  TEXT;
  warehouse_q INTEGER;
  boxed_q     INTEGER;
BEGIN
  target_sku := COALESCE(NEW.sku, OLD.sku);
  IF target_sku IS NULL THEN RETURN NULL; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN dimension = 'WAREHOUSE' THEN delta ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dimension = 'BOXED'     THEN delta ELSE 0 END), 0)::int
  INTO warehouse_q, boxed_q
  FROM sku_stock_ledger
  WHERE sku = target_sku;

  UPDATE sku_stock
  SET stock       = warehouse_q,
      boxed_stock = boxed_q,
      updated_at  = NOW()
  WHERE sku = target_sku;

  -- Late-arriving SKU (no sku_stock row yet) — create one.
  IF NOT FOUND THEN
    INSERT INTO sku_stock (sku, stock, boxed_stock, product_title)
    VALUES (target_sku, warehouse_q, boxed_q, NULL)
    ON CONFLICT (sku) DO UPDATE
      SET stock       = EXCLUDED.stock,
          boxed_stock = EXCLUDED.boxed_stock,
          updated_at  = NOW();
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sku_stock_from_ledger ON sku_stock_ledger;
CREATE TRIGGER trg_sku_stock_from_ledger
AFTER INSERT OR UPDATE OR DELETE ON sku_stock_ledger
FOR EACH ROW EXECUTE FUNCTION fn_recompute_sku_stock();

-- ─── 5. Drift detection view + reconcile helper ──────────────────────────

CREATE OR REPLACE VIEW v_sku_stock_drift AS
WITH ledger_sums AS (
  SELECT
    sku,
    COALESCE(SUM(CASE WHEN dimension = 'WAREHOUSE' THEN delta ELSE 0 END), 0)::int AS warehouse_sum,
    COALESCE(SUM(CASE WHEN dimension = 'BOXED'     THEN delta ELSE 0 END), 0)::int AS boxed_sum
  FROM sku_stock_ledger GROUP BY sku
)
SELECT
  s.sku,
  s.stock                                            AS stored_stock,
  COALESCE(ls.warehouse_sum, 0)                      AS ledger_warehouse,
  (s.stock - COALESCE(ls.warehouse_sum, 0))          AS warehouse_drift,
  s.boxed_stock                                      AS stored_boxed,
  COALESCE(ls.boxed_sum, 0)                          AS ledger_boxed,
  (s.boxed_stock - COALESCE(ls.boxed_sum, 0))        AS boxed_drift
FROM sku_stock s
LEFT JOIN ledger_sums ls USING (sku)
WHERE s.stock       <> COALESCE(ls.warehouse_sum, 0)
   OR s.boxed_stock <> COALESCE(ls.boxed_sum, 0);

COMMENT ON VIEW v_sku_stock_drift IS
  'SKUs where stored counters disagree with ledger dimension sums. Should be empty. Non-empty = a writer bypassed the ledger.';

-- Callable from an admin endpoint or cron: replay the ledger into sku_stock.
CREATE OR REPLACE FUNCTION fn_reconcile_sku_stock()
RETURNS TABLE (
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
      l.sku AS s,
      COALESCE(SUM(CASE WHEN l.dimension = 'WAREHOUSE' THEN l.delta ELSE 0 END), 0)::int AS wh,
      COALESCE(SUM(CASE WHEN l.dimension = 'BOXED'     THEN l.delta ELSE 0 END), 0)::int AS bx
    FROM sku_stock_ledger l GROUP BY l.sku
  ),
  before AS (
    SELECT ss.sku AS s, ss.stock AS old_wh, ss.boxed_stock AS old_bx
    FROM sku_stock ss JOIN computed c ON c.s = ss.sku
    WHERE ss.stock <> c.wh OR ss.boxed_stock <> c.bx
  ),
  upd AS (
    UPDATE sku_stock ss
    SET stock       = c.wh,
        boxed_stock = c.bx,
        updated_at  = NOW()
    FROM computed c
    WHERE ss.sku = c.s AND (ss.stock <> c.wh OR ss.boxed_stock <> c.bx)
    RETURNING ss.sku AS s, ss.stock AS new_wh, ss.boxed_stock AS new_bx
  )
  SELECT b.s, b.old_wh, u.new_wh, b.old_bx, u.new_bx
  FROM before b JOIN upd u USING (s);
END;
$$;

COMMIT;
