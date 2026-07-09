-- ============================================================================
-- 2026-07-03s: insight_links.source — allow 'org_rollup' (Phase 5 learning loop)
-- ============================================================================
-- The Phase 5 nightly aggregation cron (src/lib/operations/signal-rollup.ts)
-- rolls each org's own entity_signals up into per-org insight_links rows so the
-- assistant + benchmark readout can show "your own reason-code distribution"
-- alongside the seeded industry_benchmark typicals. Those computed rows are
-- neither hand-'seeded' nor a cross-org 'anonymized_agg' — they are a single
-- org's own rollup, so they need an honest third source value.
--
-- ADDITIVE + REVERSIBLE. Widens the named CHECK `insight_links_source_chk`.
-- Per .claude/rules/polymorphic-tables.md (the reason_codes CHECK-regression
-- lesson): a CHECK redefinition must RE-AFFIRM THE FULL UNION, never drop a
-- value a prior migration added. The full allowed set after this migration is
-- ('seeded','anonymized_agg','org_rollup').
--
-- Safety: no existing row is invalidated (both prior values stay legal); the
-- only new writer is the org-scoped nightly cron, which stamps each row with
-- its source org (entity_signals.organization_id, NOT NULL) so no global/NULL
-- row is ever minted by the rollup.
--
-- Rollback: DROP CONSTRAINT insight_links_source_chk; then re-add the 2-value
-- form from 2026-07-03n once any 'org_rollup' rows are deleted.
-- ============================================================================

BEGIN;

-- Drop the old constraint if present, then re-add the full union. Guarded so a
-- fresh DB (constraint absent) and an existing DB both converge.
DO $$ BEGIN
  ALTER TABLE insight_links DROP CONSTRAINT IF EXISTS insight_links_source_chk;
  ALTER TABLE insight_links ADD CONSTRAINT insight_links_source_chk
    CHECK (source IN ('seeded', 'anonymized_agg', 'org_rollup'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
