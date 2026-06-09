-- ============================================================================
-- 2026-06-08: receiving.exception_code (OS&D taxonomy)
-- ============================================================================
-- Receiving-triage streamline Phase 5. Replaces the inferred unfound/exception
-- buckets with an explicit Over-Short-Damaged reason on the carton, so the
-- Unfound triage list can chip + filter by reason and the data feeds reporting.
--
-- Values (free TEXT, validated in app via src/lib/receiving/exception-codes.ts):
--   NO_PO            — scanned carton with no matching Zoho PO (the current
--                      unmatched/unfound case).
--   CARRIER_MISMATCH — tracking# has no known carrier / carrier API has no record.
--   SHORT            — fewer units received than the PO expected.
--   OVER             — more units received than the PO expected.
--   DAMAGED          — unit(s) arrived damaged (disposition/condition driven).
--   WRONG_ITEM       — received SKU doesn't match the PO line.
--
-- Additive + idempotent. NULL = no exception (the normal case).
-- ============================================================================

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS exception_code TEXT;

CREATE INDEX IF NOT EXISTS idx_receiving_exception_code
  ON receiving(exception_code)
  WHERE exception_code IS NOT NULL;

COMMENT ON COLUMN receiving.exception_code IS
  'OS&D exception reason (Phase 5): NO_PO | CARRIER_MISMATCH | SHORT | OVER | DAMAGED | WRONG_ITEM. NULL = no exception. App-validated via src/lib/receiving/exception-codes.ts.';

COMMIT;
