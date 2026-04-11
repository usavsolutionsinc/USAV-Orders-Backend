-- ============================================================================
-- 2026-04-12: receiving_lines.zoho_reference_number
-- ============================================================================
-- Zoho PO Reference# carries the tracking number per the inbound pipeline
-- contract. Persisting it per line lets us display "Tracking" in the
-- ReceivingLinesTable even when the line hasn't been physically linked to a
-- receiving row yet (receiving_id IS NULL).
--
-- Populated on every Zoho PO sync (INSERT and UPDATE paths). Existing rows
-- backfill naturally on the next sync pass.
-- ============================================================================

BEGIN;

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS zoho_reference_number TEXT;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_reference
  ON receiving_lines (zoho_reference_number)
  WHERE zoho_reference_number IS NOT NULL;

COMMENT ON COLUMN receiving_lines.zoho_reference_number IS
  'Zoho PO Reference# — holds the tracking number per the inbound contract. Displayed as "Tracking" when no receiving row is linked.';

COMMIT;
