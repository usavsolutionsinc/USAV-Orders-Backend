-- ============================================================================
-- 2026-06-09: receiving.is_priority (shared unbox↔test urgency flag)
-- ============================================================================
-- Testing-priority plan, Phase 2. ONE explicit urgency flag, carton-level,
-- shared by the unbox queue and the tester's queue: if an order is urgent to
-- unbox it's urgent to test. Two inputs write this same column:
--   - auto  — a pending-order SKU match in /api/receiving/lookup-po sets it true
--             (today that match is only pushed over Ably; this persists it).
--   - manual — a toggle in the testing/unbox panel sets/clears it.
--
-- Read side: it becomes rank 0 (above unfound) in RECEIVING_PRIORITY_RANK_SQL
-- and the new top 'priority' tier in src/lib/receiving/scan-priority.ts, so the
-- existing Prioritize sort + TriagePriorityPanel tiles surface it for free.
-- Orthogonal to receiving_lines.needs_test (which gates WHETHER a line is
-- tested, not its order).
--
-- Additive + idempotent. false = normal (the default case).
-- ============================================================================

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_receiving_is_priority
  ON receiving(is_priority)
  WHERE is_priority = true;

COMMENT ON COLUMN receiving.is_priority IS
  'Shared unbox/test urgency flag (Phase 2). Set by pending-order match (lookup-po) or manual toggle. Drives rank-0 in RECEIVING_PRIORITY_RANK_SQL + the priority tier in scan-priority.ts. false = normal.';

COMMIT;
