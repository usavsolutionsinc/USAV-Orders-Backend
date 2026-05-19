-- ============================================================================
-- 2026-05-20: Inventory v2 — Active States (Phase A2)
-- ============================================================================
-- Adds the three "actively X" lifecycle states so supervisor dashboards can
-- distinguish in-progress work from completed work without inferring from
-- timestamps. Pairs with src/lib/inventory/state-machine.ts (Phase A1).
--
-- New serial_status_enum values:
--   PICKING — a picker has scanned a unit but not yet confirmed pick-complete.
--   PACKING — a unit has been scanned at a pack station but not yet sealed.
--   LOADING — a packed unit is on a dock cart / being loaded onto a carrier.
--
-- New tables:
--   picking_sessions — opened on first scan, closed on cart-confirm. Lets the
--   dashboard answer "who is picking which order right now?".
--
-- What this migration does NOT do:
--   - Refactor existing routes. /pack/ship continues to write SHIPPED directly.
--   - Wire any UI. Phase A2 follow-up tickets attach PICKING/PACKING flips to
--     the picker and packer flows.
-- ============================================================================

BEGIN;

-- ─── 1. serial_status_enum: active-state additions ─────────────────────────
-- Each ALTER TYPE must run outside a prior subtransaction; wrap each in DO so
-- replays are safe.

DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'PICKING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'PACKING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE serial_status_enum ADD VALUE IF NOT EXISTS 'LOADING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- ─── 2. picking_sessions ───────────────────────────────────────────────────
-- One row per (picker, order) work session. A session opens when the picker
-- accepts the order on their device and closes when the cart is confirmed.
-- Multiple consecutive sessions per order are allowed (handoffs, breaks).
--
-- Outside the previous transaction so the new enum values are visible if the
-- table references them.

BEGIN;

CREATE TABLE IF NOT EXISTS picking_sessions (
  id                BIGSERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  picker_staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  device_id         TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  abandoned         BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  CONSTRAINT chk_session_window CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Supervisor query: open sessions for a picker.
CREATE INDEX IF NOT EXISTS idx_picking_sessions_open_picker
  ON picking_sessions (picker_staff_id)
  WHERE ended_at IS NULL;

-- Supervisor query: which orders are actively being picked.
CREATE INDEX IF NOT EXISTS idx_picking_sessions_open_order
  ON picking_sessions (order_id)
  WHERE ended_at IS NULL;

-- Audit trail navigation by order.
CREATE INDEX IF NOT EXISTS idx_picking_sessions_order_started
  ON picking_sessions (order_id, started_at DESC);

COMMENT ON TABLE picking_sessions IS
  'One row per (picker, order) active work session. Opens on first scan, closes on cart-confirm. Supports the "actively picking" supervisor view.';

COMMIT;
