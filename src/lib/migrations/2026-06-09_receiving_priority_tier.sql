-- ============================================================================
-- 2026-06-09: receiving.priority_tier (manual priority-tier override)
-- ============================================================================
-- Generalizes the boolean receiving.is_priority into a selectable tier. The
-- urgency pill in the carton workspace now offers Auto + Priority/High/Medium/
-- Low; this column stores the operator's choice:
--   NULL  = Auto — fall back to the platform-derived rank (the default, and the
--           behavior for every carton that pre-dates this column).
--   0..3  = manual override: 0 Priority, 1 High, 2 Medium, 3 Low. Lower wins in
--           RECEIVING_PRIORITY_RANK_SQL, COALESCE'd ahead of the platform CASE.
--
-- is_priority is kept in lockstep (tier 0 ⇔ is_priority = true) so the shared
-- "urgent" consumers that only read the boolean (tech-queue, work-orders,
-- mark-received) keep lighting up for a top-tier carton without changing. The
-- pending-order match in lookup-po now writes tier 0 (+ is_priority = true).
--
-- Additive + idempotent. Backfills existing flagged cartons to tier 0.
-- ============================================================================

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS priority_tier SMALLINT;

ALTER TABLE receiving
  DROP CONSTRAINT IF EXISTS receiving_priority_tier_range;
ALTER TABLE receiving
  ADD CONSTRAINT receiving_priority_tier_range
  CHECK (priority_tier IS NULL OR (priority_tier >= 0 AND priority_tier <= 3));

-- Existing manually/auto-flagged cartons map to the top tier.
UPDATE receiving
  SET priority_tier = 0
  WHERE is_priority = true AND priority_tier IS NULL;

-- Partial index — the Prioritize sort only cares about the (few) overridden rows.
CREATE INDEX IF NOT EXISTS idx_receiving_priority_tier
  ON receiving(priority_tier)
  WHERE priority_tier IS NOT NULL;

COMMENT ON COLUMN receiving.priority_tier IS
  'Manual priority-tier override. NULL = Auto (platform-derived rank); 0..3 = Priority/High/Medium/Low. COALESCE''d ahead of the platform CASE in RECEIVING_PRIORITY_RANK_SQL. Kept in lockstep with is_priority (tier 0 ⇔ true).';

COMMIT;
