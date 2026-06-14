-- 2026-06-13: per-line source-order linkage for item-dependent returns / repairs.
--
-- A single inbound box can mix a customer's PO receipts, RETURNs, and repair
-- services — each line reconciles to its OWN source order and is acknowledged
-- PER LINE (industry-standard receipt-line model), not via one carton PO#.
-- The carton's zoho_purchaseorder_number stays only as a first-linked DISPLAY
-- representative; these per-line columns are the source of truth.
--
-- Mirrors repair_service.source_system / source_order_id so an Ecwid order
-- resolves the same way on both surfaces.

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS source_system     TEXT,
  ADD COLUMN IF NOT EXISTS source_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS is_repair_service BOOLEAN NOT NULL DEFAULT FALSE;

-- Reverse path: scan / search an Ecwid order# -> the receiving line(s) that
-- received it. This index IS the "if I can link it I can find/unlink it" lookup.
CREATE INDEX IF NOT EXISTS idx_receiving_lines_source_order
  ON receiving_lines (source_system, source_order_id)
  WHERE source_order_id IS NOT NULL;

COMMENT ON COLUMN receiving_lines.source_order_id IS
  'Per-line source order reference (e.g. Ecwid order# for a RETURN/repair line). Authoritative; receiving.zoho_purchaseorder_number is only a first-linked display representative.';
COMMENT ON COLUMN receiving_lines.source_system IS
  'Origin system for source_order_id (e.g. ''ecwid''). Mirrors repair_service.source_system.';
COMMENT ON COLUMN receiving_lines.is_repair_service IS
  'True when this line is an Ecwid repair-service intake (distinct from a RETURN). Set by the carton "Link repair service" flow; reverted on unlink.';
