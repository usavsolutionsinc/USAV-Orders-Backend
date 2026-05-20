-- ============================================================================
-- 2026-05-22: Inventory v2 — Pick-Face Replenishment (Phase A4)
-- ============================================================================
-- Adds the table + enum needed to track internal bin-to-bin moves that refill
-- PICK_FACE bins from RESERVE storage. Pairs with the bin-roles migration
-- (2026-05-21) and the pickability predicate.
--
-- This is DISTINCT from the existing vendor-PO replenishment flow in
-- src/lib/replenishment.ts. That one tracks "we need to order from Zoho";
-- this one tracks "we have stock in reserve and need to refill the pick face".
--
-- New enum:
--   replenishment_task_status — REQUESTED | IN_PROGRESS | COMPLETE | CANCELED
--
-- New table:
--   replenishment_tasks — one row per pending or in-flight bin-to-bin move.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE replenishment_task_status AS ENUM ('REQUESTED', 'IN_PROGRESS', 'COMPLETE', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS replenishment_tasks (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL,
  from_bin_id         INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  to_bin_id           INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  status              replenishment_task_status NOT NULL DEFAULT 'REQUESTED',
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  cancel_reason       TEXT,
  qty_moved           INTEGER,
  CONSTRAINT chk_window CHECK (
    (started_at   IS NULL OR started_at   >= detected_at) AND
    (completed_at IS NULL OR completed_at >= COALESCE(started_at, detected_at)) AND
    (canceled_at  IS NULL OR canceled_at  >= detected_at)
  ),
  CONSTRAINT chk_terminal_state CHECK (
    (status = 'COMPLETE' AND completed_at IS NOT NULL AND qty_moved IS NOT NULL) OR
    (status = 'CANCELED' AND canceled_at  IS NOT NULL) OR
    (status IN ('REQUESTED','IN_PROGRESS'))
  )
);

COMMENT ON TABLE replenishment_tasks IS
  'Pick-face replenishment task queue. One row per pending bin-to-bin move that refills a PICK_FACE bin from RESERVE storage. Distinct from src/lib/replenishment.ts (vendor-PO flow).';

-- One open task per (sku, to_bin) pair — no point creating a second one
-- before the first is closed. The partial UNIQUE skips terminal states.
CREATE UNIQUE INDEX IF NOT EXISTS uq_replenishment_open_target
  ON replenishment_tasks (sku, to_bin_id)
  WHERE status IN ('REQUESTED', 'IN_PROGRESS');

-- Supervisor query: open tasks by destination bin (for restock priorities).
CREATE INDEX IF NOT EXISTS idx_replenishment_open_to_bin
  ON replenishment_tasks (to_bin_id)
  WHERE status IN ('REQUESTED', 'IN_PROGRESS');

-- Picker query: open tasks claimed by a staffer.
CREATE INDEX IF NOT EXISTS idx_replenishment_open_assignee
  ON replenishment_tasks (assigned_staff_id)
  WHERE status = 'IN_PROGRESS';

-- Audit timeline navigation.
CREATE INDEX IF NOT EXISTS idx_replenishment_detected_at
  ON replenishment_tasks (detected_at DESC);

COMMIT;
