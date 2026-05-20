-- ============================================================================
-- 2026-05-23: Inventory v2 — RMA Entity (Phase A5)
-- ============================================================================
-- Promotes RMA from a `serial_units.current_status` flag to a first-class
-- business object. Adds the authorization record (so the warehouse knows a
-- return is expected before the carton arrives) and the per-unit disposition
-- row (so each returned unit gets a typed outcome).
--
-- New enums:
--   rma_direction_enum — INBOUND_FROM_CUSTOMER | OUTBOUND_TO_VENDOR
--   rma_status_enum    — AUTHORIZED | RECEIVED | DISPOSITIONED | CLOSED | EXPIRED | CANCELED
--
-- New tables:
--   rma_authorizations  — one row per issued RMA number
--   return_dispositions — one row per returned unit, tied back to an RMA
--                         and reusing the existing disposition_enum.
--
-- What this migration does NOT do:
--   - Migrate existing serial_units.current_status='RMA' rows into the new
--     entity. That's a one-shot script (scripts/backfill-rma-authorizations.mjs)
--     not yet written.
--   - Touch any route. The companion module lives at src/lib/rma/authorizations.ts.
-- ============================================================================

BEGIN;

-- ─── 1. Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE rma_direction_enum AS ENUM (
    'INBOUND_FROM_CUSTOMER',
    'OUTBOUND_TO_VENDOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rma_status_enum AS ENUM (
    'AUTHORIZED',
    'RECEIVED',
    'DISPOSITIONED',
    'CLOSED',
    'EXPIRED',
    'CANCELED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. rma_authorizations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rma_authorizations (
  id                    BIGSERIAL PRIMARY KEY,
  rma_number            TEXT NOT NULL UNIQUE,
  direction             rma_direction_enum NOT NULL,
  order_id              INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id           INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  authorized_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ,
  expected_carrier      TEXT,
  status                rma_status_enum NOT NULL DEFAULT 'AUTHORIZED',
  created_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  closed_at             TIMESTAMPTZ,
  notes                 TEXT
);

COMMENT ON TABLE rma_authorizations IS
  'First-class RMA record. Both customer returns (INBOUND_FROM_CUSTOMER) and vendor returns / RTV (OUTBOUND_TO_VENDOR) live here.';

-- Most common reads: "what is open?" and "show me an RMA by number".
CREATE INDEX IF NOT EXISTS idx_rma_open_status
  ON rma_authorizations (status)
  WHERE status IN ('AUTHORIZED', 'RECEIVED', 'DISPOSITIONED');

CREATE INDEX IF NOT EXISTS idx_rma_order_id
  ON rma_authorizations (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rma_direction_status
  ON rma_authorizations (direction, status);

-- ─── 3. return_dispositions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS return_dispositions (
  id                    BIGSERIAL PRIMARY KEY,
  rma_id                BIGINT REFERENCES rma_authorizations(id) ON DELETE CASCADE,
  serial_unit_id        INTEGER REFERENCES serial_units(id) ON DELETE SET NULL,
  disposition_code      disposition_enum NOT NULL,
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by_staff_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  notes                 TEXT,
  inventory_event_id    BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  CONSTRAINT chk_disposition_link CHECK (
    rma_id IS NOT NULL OR serial_unit_id IS NOT NULL
  )
);

COMMENT ON TABLE return_dispositions IS
  'Per-unit decision after a return arrives: ACCEPT/HOLD/RTV/REWORK/SCRAP. Reuses disposition_enum from the receiving workflow so the same vocabulary covers both inbound channels.';

-- Lookup all dispositions for an RMA (most common detail query).
CREATE INDEX IF NOT EXISTS idx_dispositions_rma
  ON return_dispositions (rma_id);

-- "Show me the history for this unit."
CREATE INDEX IF NOT EXISTS idx_dispositions_unit
  ON return_dispositions (serial_unit_id, decided_at DESC);

COMMIT;
