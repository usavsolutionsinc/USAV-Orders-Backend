-- ============================================================================
-- 2026-06-06: Close the return loop (Relational-reuse plan, Phase 1)
-- ============================================================================
-- The shipped → returned serial pairing query already exists
-- (findShippedOrderForSerialUnit / findShippedOrderByTsnSerial in
-- src/lib/neon/serial-units-queries.ts) but was wired only into the read-only
-- /api/serial-units/lookup endpoint. The returns WRITE path
-- (src/lib/inventory/returns.ts) never resolved the prior order, never
-- persisted the link, and never advanced the original allocation.
--
-- This migration makes the original order_unit_allocations row the durable,
-- queryable reverse-link: when a unit comes back, its open SHIPPED allocation
-- flips to RETURNED. "Show all returns for order X" becomes a plain JOIN:
--   SELECT * FROM order_unit_allocations WHERE order_id = X AND state = 'RETURNED'
--
-- Why the index change matters: idx_oua_open_unit enforces one OPEN allocation
-- per unit via WHERE state <> 'RELEASED'. RETURNED must join RELEASED in the
-- "closed" set so a refurbed unit can be re-allocated to a new order, while the
-- RETURNED row is preserved for history.
--
-- Legacy (tech_serial_numbers) ships have no allocation row to flip; for those
-- the resolved order_id is stamped on the RETURNED inventory_events.payload by
-- the application path. No new column on `receiving` (serial-based intake never
-- creates a receiving row).
-- ============================================================================

BEGIN;

-- ─── 1. Allow the RETURNED state ──────────────────────────────────────────
ALTER TABLE order_unit_allocations DROP CONSTRAINT IF EXISTS oua_state_chk;
ALTER TABLE order_unit_allocations
  ADD CONSTRAINT oua_state_chk
  CHECK (state IN ('ALLOCATED','PICKED','PACKED','SHIPPED','RETURNED','RELEASED'));

-- ─── 2. Provenance columns for the return transition ──────────────────────
ALTER TABLE order_unit_allocations
  ADD COLUMN IF NOT EXISTS returned_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_reason TEXT;

-- ─── 3. RETURNED is a CLOSED state — free the unit for re-allocation ──────
-- Recreate the partial unique index so RETURNED (like RELEASED) no longer
-- counts as an open allocation.
DROP INDEX IF EXISTS idx_oua_open_unit;
CREATE UNIQUE INDEX IF NOT EXISTS idx_oua_open_unit
  ON order_unit_allocations (serial_unit_id)
  WHERE state NOT IN ('RELEASED','RETURNED');

-- Fast "returns for an order" lookups (state already indexed via
-- idx_oua_order_state; this targets the RETURNED slice with the timestamp).
CREATE INDEX IF NOT EXISTS idx_oua_returned
  ON order_unit_allocations (order_id, returned_at DESC)
  WHERE state = 'RETURNED';

COMMENT ON COLUMN order_unit_allocations.returned_at IS
  'Set when a SHIPPED allocation is flipped to RETURNED by the returns/RMA intake (relational-reuse plan Phase 1).';

COMMIT;
