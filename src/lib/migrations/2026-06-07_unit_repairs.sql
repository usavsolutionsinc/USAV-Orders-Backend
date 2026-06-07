-- Repair history — per-serial repair records + failure-mode resolution links.
--
-- Part of the Condition Grading + Repair History QC System
-- (docs/condition-grading-repair-qc-plan.md §4.5, Phase 3). Replaces the
-- orphaned text-only link in repair_service (which matches by serial string) with
-- a real FK to serial_units, and ties repairs to the failure modes they fix.
--
-- Three structural changes:
--
--   1. unit_repairs — one row per repair attempt on a serial unit. Opened
--      (pending/in_progress) then completed/failed/scrapped. Carries parts/cost/
--      labor and cross-links the REPAIR_STARTED / REPAIR_COMPLETED inventory
--      events. `repair_service_id` bridges the legacy intake table (not replaced).
--
--   2. repair_failure_resolutions — which failure modes a repair addresses.
--
--   3. unit_failure_tags.resolved_repair_id — completing a repair stamps the
--      tags it resolved (the column deferred from 2026-06-07_failure_modes.sql,
--      added now that unit_repairs exists).
--
-- status is plain TEXT with a CHECK (not an enum) to avoid enum-ALTER churn.
-- Serial lifecycle uses the existing IN_REPAIR / REPAIR_DONE statuses and the
-- REPAIR_STARTED / REPAIR_COMPLETED inventory-event types — no new enum values.

BEGIN;

CREATE TABLE IF NOT EXISTS unit_repairs (
  id                    SERIAL PRIMARY KEY,
  serial_unit_id        INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending',
  summary               TEXT NOT NULL,
  parts_used            JSONB,
  labor_minutes         INTEGER,
  cost_cents            INTEGER,
  started_at            TIMESTAMPTZ,
  started_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  completed_at          TIMESTAMPTZ,
  completed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  rma_id                INTEGER REFERENCES rma_authorizations(id) ON DELETE SET NULL,
  repair_service_id     INTEGER REFERENCES repair_service(id) ON DELETE SET NULL,
  start_event_id        BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  done_event_id         BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE unit_repairs
  DROP CONSTRAINT IF EXISTS unit_repairs_status_chk;
ALTER TABLE unit_repairs
  ADD CONSTRAINT unit_repairs_status_chk
  CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'scrapped'));

CREATE INDEX IF NOT EXISTS idx_unit_repairs_unit ON unit_repairs (serial_unit_id);

CREATE TABLE IF NOT EXISTS repair_failure_resolutions (
  repair_id       INTEGER NOT NULL REFERENCES unit_repairs(id) ON DELETE CASCADE,
  failure_mode_id INTEGER NOT NULL REFERENCES failure_modes(id),
  PRIMARY KEY (repair_id, failure_mode_id)
);

ALTER TABLE unit_failure_tags
  ADD COLUMN IF NOT EXISTS resolved_repair_id INTEGER REFERENCES unit_repairs(id) ON DELETE SET NULL;

COMMIT;
