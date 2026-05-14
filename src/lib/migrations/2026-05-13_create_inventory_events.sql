-- ============================================================================
-- 2026-05-13: inventory_events — lifecycle / audit timeline
-- ============================================================================
-- Sibling to sku_stock_ledger.
--
--   sku_stock_ledger  → quantity deltas (trigger projects sku_stock.stock)
--   inventory_events  → lifecycle timeline (status, putaway, move, test, …)
--
-- They join on inventory_events.stock_ledger_id when an event also moved
-- quantity. The trail surface (v_last_touch_*) reads from inventory_events.
--
-- Relaxed: serial_unit_id is nullable. Non-serialized parts still get events,
-- keyed on receiving_line_id + sku, optionally with payload.unit_ordinal.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_events (
  id                BIGSERIAL PRIMARY KEY,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type        TEXT NOT NULL,
  -- Allowed event_type values (kept as TEXT for forward-compat, validated app-side):
  --   RECEIVED | TEST_START | TEST_PASS | TEST_FAIL
  --   PUTAWAY  | MOVED      | PICKED    | PACKED  | SHIPPED
  --   ADJUSTED | RETURNED   | SCRAPPED  | LISTED  | NOTE

  -- Actor
  actor_staff_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  station           TEXT,  -- RECEIVING | TECH | PACK | SHIP | MOBILE | SYSTEM

  -- Subject (at least one of these is set)
  receiving_id      BIGINT,                                          -- receiving.id
  receiving_line_id BIGINT REFERENCES receiving_lines(id) ON DELETE SET NULL,
  serial_unit_id    INTEGER REFERENCES serial_units(id)  ON DELETE SET NULL,
  sku               TEXT,

  -- Spatial
  bin_id            INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  prev_bin_id       INTEGER REFERENCES locations(id) ON DELETE SET NULL,

  -- State diff
  prev_status       TEXT,
  next_status       TEXT,

  -- Linkage back to the quantity event (if any)
  stock_ledger_id   INTEGER REFERENCES sku_stock_ledger(id) ON DELETE SET NULL,

  -- Raw scan + idempotency
  scan_token        TEXT,
  client_event_id   TEXT UNIQUE,

  notes             TEXT,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ie_sku_time
  ON inventory_events (sku, occurred_at DESC) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ie_serial_time
  ON inventory_events (serial_unit_id, occurred_at DESC) WHERE serial_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ie_line_time
  ON inventory_events (receiving_line_id, occurred_at DESC) WHERE receiving_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ie_receiving_time
  ON inventory_events (receiving_id, occurred_at DESC) WHERE receiving_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ie_bin_time
  ON inventory_events (bin_id, occurred_at DESC) WHERE bin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ie_actor_time
  ON inventory_events (actor_staff_id, occurred_at DESC) WHERE actor_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ie_type_time
  ON inventory_events (event_type, occurred_at DESC);

COMMENT ON TABLE  inventory_events                IS 'Lifecycle/audit timeline. Sibling to sku_stock_ledger (quantity). Joins via stock_ledger_id.';
COMMENT ON COLUMN inventory_events.event_type     IS 'RECEIVED|TEST_START|TEST_PASS|TEST_FAIL|PUTAWAY|MOVED|PICKED|PACKED|SHIPPED|ADJUSTED|RETURNED|SCRAPPED|LISTED|NOTE';
COMMENT ON COLUMN inventory_events.serial_unit_id IS 'NULL when the event applies to a non-serialized unit (use payload.unit_ordinal for ordering within a line).';
COMMENT ON COLUMN inventory_events.stock_ledger_id IS 'sku_stock_ledger.id when this event also moved on-hand quantity (RECEIVED, SHIPPED, ADJUSTED, …).';
COMMENT ON COLUMN inventory_events.client_event_id IS 'UNIQUE — mobile clients send this for idempotent retries.';

-- ─── Backfill historical RECEIVED events from sku_stock_ledger ─────────────
-- One RECEIVED event per ledger row already in the system. Idempotent via
-- client_event_id derived from ledger id.

INSERT INTO inventory_events (
  occurred_at, event_type, actor_staff_id, station,
  receiving_line_id, serial_unit_id, sku,
  stock_ledger_id, client_event_id, notes
)
SELECT
  l.created_at,
  'RECEIVED',
  l.staff_id,
  'RECEIVING',
  l.ref_receiving_line_id,
  l.ref_serial_unit_id,
  l.sku,
  l.id,
  'backfill-ledger-' || l.id::text,
  l.notes
FROM sku_stock_ledger l
WHERE l.reason = 'RECEIVED'
  AND l.delta > 0
ON CONFLICT (client_event_id) DO NOTHING;

-- ─── Last-touch views (one row per subject, the most recent event) ─────────

DROP VIEW IF EXISTS v_last_touch_sku;
CREATE VIEW v_last_touch_sku AS
SELECT DISTINCT ON (sku)
       sku,
       occurred_at        AS last_touched_at,
       event_type         AS last_event_type,
       next_status        AS last_status,
       actor_staff_id,
       bin_id,
       serial_unit_id,
       receiving_line_id
FROM inventory_events
WHERE sku IS NOT NULL
ORDER BY sku, occurred_at DESC, id DESC;

DROP VIEW IF EXISTS v_last_touch_serial;
CREATE VIEW v_last_touch_serial AS
SELECT DISTINCT ON (serial_unit_id)
       serial_unit_id,
       occurred_at        AS last_touched_at,
       event_type         AS last_event_type,
       next_status        AS last_status,
       actor_staff_id,
       bin_id,
       sku,
       receiving_line_id
FROM inventory_events
WHERE serial_unit_id IS NOT NULL
ORDER BY serial_unit_id, occurred_at DESC, id DESC;

DROP VIEW IF EXISTS v_last_touch_line;
CREATE VIEW v_last_touch_line AS
SELECT DISTINCT ON (receiving_line_id)
       receiving_line_id,
       occurred_at        AS last_touched_at,
       event_type         AS last_event_type,
       next_status        AS last_status,
       actor_staff_id,
       bin_id,
       sku
FROM inventory_events
WHERE receiving_line_id IS NOT NULL
ORDER BY receiving_line_id, occurred_at DESC, id DESC;

DROP VIEW IF EXISTS v_last_touch_receiving;
CREATE VIEW v_last_touch_receiving AS
SELECT DISTINCT ON (receiving_id)
       receiving_id,
       occurred_at        AS last_touched_at,
       event_type         AS last_event_type,
       actor_staff_id
FROM inventory_events
WHERE receiving_id IS NOT NULL
ORDER BY receiving_id, occurred_at DESC, id DESC;

COMMIT;
