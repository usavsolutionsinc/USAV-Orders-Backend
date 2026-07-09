-- ============================================================================
-- 2026-07-03q: insight_links — seeded reseller-vertical benchmarks (Phase 1 of
-- docs/todo/universal-feed-polymorphic-plan.md §2.5)
-- ============================================================================
-- Hand-authored GLOBAL benchmark rows (organization_id NULL — readable by all
-- orgs per 2026-07-03n's RLS) for the used-electronics-reseller vertical, so
-- /operations and the assistant can answer "you vs typical" from day one:
-- test-fail %, return %, receive→list days (the three the plan locks).
--
-- VALUES ARE EDITABLE SEEDS (metrics.editable_seed = true, metrics.basis
-- documents the estimate) — v1 estimates for a small used-electronics
-- reseller, to be tuned by hand or replaced by anonymized cross-org
-- aggregates (source='anonymized_agg') once multi-tenant volume exists.
--
-- Idempotent: ON CONFLICT DO NOTHING against ux_insight_links_global_subject
-- (partial unique on (linkage_type, subject_kind, subject_ref) WHERE
-- organization_id IS NULL AND subject_ref IS NOT NULL) — re-running never
-- duplicates, and hand-tuned values are never clobbered.
--
-- Ordering: must apply after 2026-07-03n_insight_links.sql (letter q > n).
--
-- ROLLBACK:
--   DELETE FROM insight_links WHERE organization_id IS NULL AND source = 'seeded';
-- ============================================================================

BEGIN;

INSERT INTO insight_links (organization_id, linkage_type, subject_kind, subject_ref, metrics, source)
VALUES
  (NULL, 'industry_benchmark', 'signal_kind', 'test_fail_reason',
   '{"metric": "test_fail_pct", "typical_pct": 12, "range_pct": [8, 18],
     "basis": "share of first bench tests that do not PASS, typical small used-electronics reseller",
     "editable_seed": true, "seed_version": 1}'::jsonb,
   'seeded'),
  (NULL, 'industry_benchmark', 'signal_kind', 'return_reason',
   '{"metric": "return_pct", "typical_pct": 8, "range_pct": [5, 12],
     "basis": "share of shipped marketplace orders returned, used electronics (eBay-heavy mix)",
     "editable_seed": true, "seed_version": 1}'::jsonb,
   'seeded'),
  (NULL, 'industry_benchmark', 'node_type', 'list_ebay',
   '{"metric": "receive_to_list_days", "typical_days": 5, "range_days": [3, 9],
     "basis": "median calendar days from dock receive to marketplace listing",
     "editable_seed": true, "seed_version": 1}'::jsonb,
   'seeded'),
  (NULL, 'suggestion_seed', 'signal_kind', 'test_fail_reason',
   '{"trigger": "test_fail_pct above range", "suggestion": "Review the top fail reasons by node (get_top_reasons) and check whether one SKU family or supplier dominates before adding bench capacity.",
     "editable_seed": true, "seed_version": 1}'::jsonb,
   'seeded')
ON CONFLICT DO NOTHING;

COMMIT;
