-- ============================================================================
-- 2026-06-21: receiving staff-filter partial indexes (P1-WORK-02 perf)
-- ============================================================================
-- The universal "?staff=" filter on /api/receiving-lines narrows the carton
-- list to one operator via:
--   r.received_by = $N
--   OR r.unboxed_by = $N
--   OR EXISTS (SELECT 1 FROM receiving_scans rs WHERE rs.receiving_id = r.id
--              AND rs.scanned_by = $N)
-- Without supporting indexes these are seq scans over receiving / receiving_scans
-- on every filtered History/unbox query (also run twice — main SELECT + COUNT).
-- These partial indexes back the equality lookups; partial-on-NOT-NULL keeps
-- them small (most rows have a NULL staff column) and skips the irrelevant rows.
--
-- Additive + non-destructive: index-only, no column/data changes, no Zoho touch,
-- no serial mutation. IF NOT EXISTS makes re-runs safe.
--
-- Reversible (down-path):
--   DROP INDEX IF EXISTS idx_receiving_received_by;
--   DROP INDEX IF EXISTS idx_receiving_unboxed_by;
--   DROP INDEX IF EXISTS idx_receiving_scans_scanned_by;
--
-- NOTE: UNAPPLIED. Run `npm run db:migrate` to apply. (Plain CREATE INDEX so it
-- runs inside the migrator's transaction; switch to CREATE INDEX CONCURRENTLY
-- run outside a txn only if lock contention on these tables becomes a concern.)
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_receiving_received_by
  ON receiving(received_by) WHERE received_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_unboxed_by
  ON receiving(unboxed_by) WHERE unboxed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_scans_scanned_by
  ON receiving_scans(scanned_by) WHERE scanned_by IS NOT NULL;

COMMIT;
