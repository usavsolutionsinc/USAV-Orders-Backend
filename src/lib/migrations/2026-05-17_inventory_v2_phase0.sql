-- ============================================================================
-- 2026-05-17: Inventory v2 — Phase 0
-- ============================================================================
-- Schema-only foundation for the inventory rewrite described in
-- context/inventory_system_upgrade_plan.md. Zero behavior change in this
-- migration: existing routes keep their current shape; this prepares the
-- ground for Phase 1+ wire-up.
--
-- What this migration does:
--   1. Expand serial_status_enum with refurb + allocation states.
--   2. Create serial_unit_condition_history — per-unit grade timeline.
--   3. Create order_unit_allocations — order-to-unit reservation ledger
--      with DEFERRABLE UNIQUE on serial_unit_id WHERE state != 'RELEASED'.
--   4. Create fba_shipment_item_units — Tier-3 serial linkage for FBA items.
--   5. Create unit_id_sequences — per-SKU-per-year unit ID counter.
--
-- What this migration does NOT do:
--   - Touch any existing route. All existing reads/writes continue to work.
--   - Backfill any existing data. The companion script
--     scripts/backfill-tech-serial-unit-id.mjs handles tech_serial_numbers
--     → serial_units linking; that one is run separately.
-- ============================================================================

BEGIN;

-- ─── 1. serial_status_enum: refurb + allocation states ─────────────────────
-- Done as separate ALTER TYPE … ADD VALUE statements (each must run outside a
-- prior subtransaction). Wrapped in DO blocks for replayability.

DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'TRIAGED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'IN_REPAIR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'REPAIR_DONE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'IN_TEST';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'GRADED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'ALLOCATED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'PACKED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'LABELED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'STAGED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'ON_HOLD';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- ─── 2. serial_unit_condition_history ──────────────────────────────────────
-- Outside transaction so the new enum values are visible to the table-create
-- block on systems where the planner caches enum membership per session.

BEGIN;

CREATE TABLE IF NOT EXISTS serial_unit_condition_history (
  id                    BIGSERIAL PRIMARY KEY,
  serial_unit_id        INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  assessed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assessed_by_staff_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  prev_grade            condition_grade_enum,
  new_grade             condition_grade_enum NOT NULL,
  cosmetic_notes        TEXT,
  functional_notes      TEXT,
  inventory_event_id    BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  CONSTRAINT chk_grade_changed CHECK (prev_grade IS DISTINCT FROM new_grade)
);

CREATE INDEX IF NOT EXISTS idx_such_unit_time
  ON serial_unit_condition_history (serial_unit_id, assessed_at);

CREATE INDEX IF NOT EXISTS idx_such_event
  ON serial_unit_condition_history (inventory_event_id)
  WHERE inventory_event_id IS NOT NULL;

COMMENT ON TABLE serial_unit_condition_history IS
  'Append-only per-unit grade timeline. One row per condition change. Joins to inventory_events for the producing event.';

-- ─── 3. order_unit_allocations ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_unit_allocations (
  id                       BIGSERIAL PRIMARY KEY,
  order_id                 INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  serial_unit_id           INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE RESTRICT,
  allocated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  allocated_by_staff_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  state                    TEXT NOT NULL DEFAULT 'ALLOCATED',
  released_at              TIMESTAMPTZ,
  released_reason          TEXT,
  CONSTRAINT oua_state_chk
    CHECK (state IN ('ALLOCATED','PICKED','PACKED','SHIPPED','RELEASED'))
);

-- Partial unique index: at most one OPEN (non-RELEASED) allocation per unit.
-- Released rows stay for history. This is the application-level "no
-- double-allocation" guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oua_open_unit
  ON order_unit_allocations (serial_unit_id)
  WHERE state <> 'RELEASED';

CREATE INDEX IF NOT EXISTS idx_oua_order_state
  ON order_unit_allocations (order_id, state);

CREATE INDEX IF NOT EXISTS idx_oua_state_time
  ON order_unit_allocations (state, allocated_at DESC);

COMMENT ON TABLE order_unit_allocations IS
  'Reservation of a specific serialized unit to an order line. One OPEN allocation per unit (partial unique idx idx_oua_open_unit); RELEASED rows preserved for history.';

-- ─── 4. fba_shipment_item_units ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fba_shipment_item_units (
  fba_shipment_item_id  INTEGER NOT NULL REFERENCES fba_shipment_items(id) ON DELETE CASCADE,
  serial_unit_id        INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE RESTRICT,
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by_staff_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  PRIMARY KEY (fba_shipment_item_id, serial_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_fsiu_unit
  ON fba_shipment_item_units (serial_unit_id);

COMMENT ON TABLE fba_shipment_item_units IS
  'Tier-3 serial linkage for FBA shipment items. Tier-1/2 (non-serialized) FNSKU lines remain quantity-only.';

-- ─── 5. unit_id_sequences ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unit_id_sequences (
  sku_catalog_id  INTEGER NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  next_seq        INTEGER NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sku_catalog_id, year),
  CONSTRAINT uis_seq_positive CHECK (next_seq >= 1)
);

COMMENT ON TABLE unit_id_sequences IS
  'Per-SKU-per-year counter for unit ID generation. Format: {SKU_SHORT}-{YEAR}-{SEQ:06}. Atomic increment via UPDATE … RETURNING.';

-- Convenience: allocate the next sequence number for (sku_catalog_id, year)
-- as a single atomic operation. Returns the issued integer.
CREATE OR REPLACE FUNCTION fn_next_unit_seq(p_sku_catalog_id INT, p_year INT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  issued INT;
BEGIN
  INSERT INTO unit_id_sequences (sku_catalog_id, year, next_seq)
  VALUES (p_sku_catalog_id, p_year, 2)
  ON CONFLICT (sku_catalog_id, year) DO UPDATE
    SET next_seq = unit_id_sequences.next_seq + 1,
        updated_at = NOW()
  RETURNING next_seq - 1 INTO issued;
  RETURN issued;
END;
$$;

COMMENT ON FUNCTION fn_next_unit_seq(INT, INT) IS
  'Atomically issue the next unit sequence number for (sku_catalog_id, year). Use this — do not read next_seq directly.';

COMMIT;
