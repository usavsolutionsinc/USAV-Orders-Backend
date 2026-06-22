-- ============================================================================
-- 2026-06-22: workflow_runs indexes for the Flow² metrics read API (Studio ST2)
-- ============================================================================
-- The Flow² lens (GET /api/studio/flow) reads workflow_runs two ways that the
-- existing indexes (pkey, serial_unit_id, (org, created_at)) don't cover well:
--
--   1. Per-(definition, node_type) port distribution + dwell aggregation
--      → GROUP BY workflow_definition_id, node_type
--   2. Per-unit time-in-node via lag() over runs ordered by created_at
--      → PARTITION BY serial_unit_id ORDER BY created_at, scoped to a definition
--
-- Both are read-time aggregations that scan a definition's runs; without these
-- they fall back to the (org, created_at) index + a filter/sort. Tiny today
-- (~139 rows) but the table grows one row per node-advance forever, so add the
-- covering indexes before the read path ships (roadmap §6 pre-flight).
--
-- ADDITIVE + IDEMPOTENT. Index-only; no data change, no RLS surface.
-- ============================================================================

-- Port distribution / dwell GROUP BY (Flow² fail-rate + per-type metrics).
CREATE INDEX IF NOT EXISTS idx_workflow_runs_def_nodetype
  ON workflow_runs (workflow_definition_id, node_type);

-- Per-unit dwell window: lag(created_at) over each unit's runs within a definition.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_def_unit_created
  ON workflow_runs (workflow_definition_id, serial_unit_id, created_at);
