-- ============================================================================
-- 2026-06-28o: drop the inert receiving.expected_box_count column
-- ============================================================================
-- expected_box_count was added for a multi-box PO "boxes received" rollup
-- (docs/multi-tracking-po-plan.md) but was never wired: 100% NULL across all
-- rows (n_distinct = 0), no INSERT/UPDATE write path, and the only code
-- reference was an inert Drizzle stub (src/lib/drizzle/schema.ts) — no raw SQL
-- ever SELECTs it. The stub is removed in the same change.
--
-- No deploy gate: nothing in the running app reads or writes this column, so
-- dropping it cannot 500 any live query. (Recoverable via Neon PITR regardless.)
-- ============================================================================

BEGIN;

ALTER TABLE receiving DROP COLUMN IF EXISTS expected_box_count;

COMMIT;
