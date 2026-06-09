-- ============================================================================
-- 2026-06-08: unified inbound handling unit (LPN + receiving_lines.shipment_id)
-- ============================================================================
-- Receiving-triage streamline Phase 3 (docs/receiving-triage-streamline-plan.md).
--
-- Dissolves the two-representation split where an incoming PO lives both as
-- receiving_lines (SKU/item_name, but no delivery signal) and a
-- shipping_tracking_numbers row (delivery signal, but no line data), joined only
-- at the header level via zoho_po_mirror PO# matching. After this:
--   • receiving.lpn               — stable carton license plate, survives
--                                   putaway/move/consolidation (replaces the
--                                   overloaded tracking# as carton identity).
--   • receiving_lines.shipment_id — direct FK so a line resolves to its
--                                   shipment (and the delivered-unscanned
--                                   surface resolves line-level SKU/order#)
--                                   WITHOUT the fragile last-8-digit match.
--
-- Additive + idempotent. No behavior change until RECEIVING_UNIFIED_INBOUND is
-- flipped (the reader/sync/lookup paths are flag-gated). Backfill is a separate
-- step: scripts/backfill-inbound-handling-unit.sql.
-- ============================================================================

BEGIN;

-- Stable carton license plate. Unique only among non-null values so existing
-- rows (lpn NULL) don't collide; the sync/lookup assigns one on first scan.
ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS lpn TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receiving_lpn_uniq
  ON receiving(lpn)
  WHERE lpn IS NOT NULL;

COMMENT ON COLUMN receiving.lpn IS
  'License plate number — stable carton identity for the unified inbound model (Phase 3). Survives putaway/move; replaces the overloaded tracking# as the primary carton key in lookup-po.';

-- Direct line → shipment link. Lets the delivered-unscanned surface and
-- view=incoming/scanned resolve line-level SKU/order# straight from the
-- shipment, retiring the LEFT JOIN LATERAL PO#-guess.
ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS shipment_id BIGINT
    REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_shipment_id
  ON receiving_lines(shipment_id)
  WHERE shipment_id IS NOT NULL;

COMMENT ON COLUMN receiving_lines.shipment_id IS
  'FK to shipping_tracking_numbers (Phase 3). Direct line→shipment link so a delivered shipment resolves its line-level SKU/item_name/order# without last-8-digit tracking matching. Stamped by incoming-po-sync when the PO carries a tracking; backfilled from receiving.shipment_id for already-linked lines.';

COMMIT;
