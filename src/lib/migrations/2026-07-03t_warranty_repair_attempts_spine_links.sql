-- ============================================================================
-- 2026-07-03t: warranty_repair_attempts — spine links (Phase 1, no merge)
-- ============================================================================
-- Phase 1 of docs/todo/schema-wide-polymorphic-refactor-plan.md ("repair
-- cluster"). Per the 2026-07-04 decision: KEEP warranty_repair_attempts as its
-- own (claim-anchored) table — do NOT merge it into unit_repairs — but give it
-- the same spine anchoring unit_repairs has (the "good model"): a direct
-- serial_unit_id and start/done cross-links into inventory_events, so a warranty
-- repair attempt shows up on the unit's lifecycle timeline instead of being
-- bridged only by loose integer pointers.
--
-- serial_unit_id is denormalized from claim_id → warranty_claims.serial_unit_id
-- (one join away today); populated at WRITE time by the domain helper (house
-- pattern) and kept consistent there. Nullable — a warranty attempt on a
-- customer/warranty device that was never inventory has no serial_unit.
--
-- ADDITIVE + REVERSIBLE. Table is EMPTY (0 rows) — no backfill. Types:
-- serial_unit_id INTEGER (serial_units.id = SERIAL), start/done_event_id BIGINT
-- (inventory_events.id = BIGSERIAL). warranty_repair_attempts is already
-- org-scoped + FORCE-RLS.
--
-- ROLLBACK:
--   ALTER TABLE warranty_repair_attempts
--     DROP COLUMN IF EXISTS serial_unit_id,
--     DROP COLUMN IF EXISTS start_event_id,
--     DROP COLUMN IF EXISTS done_event_id;
-- ============================================================================

BEGIN;

ALTER TABLE warranty_repair_attempts
  ADD COLUMN IF NOT EXISTS serial_unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS start_event_id BIGINT,
  ADD COLUMN IF NOT EXISTS done_event_id  BIGINT;

DO $$ BEGIN
  ALTER TABLE warranty_repair_attempts ADD CONSTRAINT warranty_repair_attempts_serial_unit_id_fkey
    FOREIGN KEY (serial_unit_id) REFERENCES serial_units(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE warranty_repair_attempts ADD CONSTRAINT warranty_repair_attempts_start_event_id_fkey
    FOREIGN KEY (start_event_id) REFERENCES inventory_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE warranty_repair_attempts ADD CONSTRAINT warranty_repair_attempts_done_event_id_fkey
    FOREIGN KEY (done_event_id) REFERENCES inventory_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_warranty_repair_attempts_serial_unit
  ON warranty_repair_attempts (organization_id, serial_unit_id);

COMMENT ON COLUMN warranty_repair_attempts.serial_unit_id IS
  'Spine anchor (2026-07-03t) — denormalized from the claim; populated at write time. Nullable for non-inventory warranty devices. warranty_repair_attempts stays a separate claim-anchored table (NOT merged into unit_repairs).';

COMMIT;
