-- ============================================================================
-- 2026-06-08: handling units (LPN) — boxes that decouple from the receipt
-- ============================================================================
-- docs/handling-unit-lpn-plan.md — Phase H1 (additive).
--
-- `R-{id}` already identifies an inbound CARTON (one `receiving` row). It is 1:1
-- with the receipt and cannot decouple. After unboxing, items get re-sorted into
-- testing boxes/trays by type/condition, and a tray can draw from more than one
-- inbound carton. That physical grouping — the HANDLING UNIT — is distinct from
-- the receipt and is what carries a license plate (LPN), `H-{id}`.
--
-- The atom an LPN groups is the `serial_unit` (units are what testing works on).
-- A unit keeps its `origin_receiving_line_id` (where it came from) AND gains a
-- `handling_unit_id` (what box it's in now) — independent of `receiving`.
--
-- Membership is CURRENT, not historical: moving a unit to another box reassigns
-- `handling_unit_id`. A `handling_unit_events` audit table is a later add if
-- box-to-box movement history is ever needed (see plan §8).
--
-- Supersedes the redundant `receiving.lpn` (RC-/H- alias) added in
-- 2026-06-08_inbound_handling_unit.sql — that column was a 1:1 alias of
-- `receiving.id`. This model replaces it; the alias is dropped in Phase H6 once
-- nothing reads it.
--
-- Additive + idempotent. Safe to run anytime; once applied the feature works
-- with no further toggles (the H- scan class is a no-op until boxes exist).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS handling_units (
  id            BIGSERIAL PRIMARY KEY,
  -- 'H-{id}' (auto, via trigger) — or an external tote/barcode later (Option C).
  -- A real column (not derived) so a scanned external tote code can occupy it.
  code          TEXT UNIQUE NOT NULL,
  -- OPEN → STAGED → IN_TEST → CLOSED. Rolled up from member unit test state.
  status        TEXT NOT NULL DEFAULT 'OPEN',
  location_id   BIGINT REFERENCES locations(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES staff(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  notes         TEXT,
  CONSTRAINT handling_units_status_chk
    CHECK (status IN ('OPEN', 'STAGED', 'IN_TEST', 'CLOSED'))
);

COMMENT ON TABLE handling_units IS
  'License-plated physical box/tray (LPN, H-{id}) grouping serial_units across any receipts/POs. Decoupled from the receipt (receiving). docs/handling-unit-lpn-plan.md.';
COMMENT ON COLUMN handling_units.code IS
  'H-{id} (auto) or an external tote barcode. Unique. Scan model: routeScan() parses the H- prefix → /m/h/{id}.';
COMMENT ON COLUMN handling_units.status IS
  'OPEN | STAGED | IN_TEST | CLOSED. Rolls up from member unit test state: IN_TEST on first verdict, CLOSED when all units reach a terminal test state.';

-- Auto-mint the H-{id} code on insert when the caller didn't supply one. The
-- BIGSERIAL default for `id` is filled before BEFORE-INSERT triggers fire, so
-- NEW.id is already populated here. Leaving `code` settable preserves room for
-- external tote barcodes (Option C) — only blank codes get the H- default.
CREATE OR REPLACE FUNCTION set_handling_unit_code()
RETURNS trigger AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    NEW.code := 'H-' || NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_handling_unit_code ON handling_units;
CREATE TRIGGER trg_handling_unit_code
  BEFORE INSERT ON handling_units
  FOR EACH ROW EXECUTE FUNCTION set_handling_unit_code();

CREATE INDEX IF NOT EXISTS idx_handling_units_status
  ON handling_units(status);
CREATE INDEX IF NOT EXISTS idx_handling_units_location
  ON handling_units(location_id)
  WHERE location_id IS NOT NULL;

-- The decouple: a unit keeps origin_receiving_line_id (provenance) AND gains
-- handling_unit_id (the box it's physically in now). ON DELETE SET NULL so
-- dropping a box doesn't cascade-delete its units — they just become unboxed.
ALTER TABLE serial_units
  ADD COLUMN IF NOT EXISTS handling_unit_id BIGINT
    REFERENCES handling_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_serial_units_handling_unit
  ON serial_units(handling_unit_id)
  WHERE handling_unit_id IS NOT NULL;

COMMENT ON COLUMN serial_units.handling_unit_id IS
  'FK to handling_units — the physical box/tray (LPN) this unit is currently in. Independent of origin_receiving_line_id (provenance). Reassigned on move; NULL = unboxed. docs/handling-unit-lpn-plan.md.';

COMMIT;
