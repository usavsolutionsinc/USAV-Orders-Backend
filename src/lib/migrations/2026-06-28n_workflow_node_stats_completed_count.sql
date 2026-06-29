-- ============================================================================
-- 2026-06-28n: workflow_node_stats.completed_count — captured daily THROUGHPUT
-- ============================================================================
-- The daily snapshot (2026-06-11d) freezes WIP only: queue_depth / blocked /
-- error / oldest_entered_at per (definition, node, day). That answers "how much
-- is piled up" but NOT "how much got DONE" — and week-over-week throughput lift
-- (the first-week ROI proof) needs the latter without re-scanning workflow_runs
-- every read.
--
-- completed_count = units that EXITED the node on snapshot_date, derived from
-- workflow_runs (one row per node execution / advance). Populated by
-- runWorkflowNodeStatsSnapshot (src/lib/workflow/node-stats.ts): the 00:45 cron
-- finalizes the prior day's completions onto that day's row, so every day's
-- throughput is captured exactly once and SUM(completed_count) over a date range
-- is the throughput for that range — no recompute.
--
-- ADDITIVE + IDEMPOTENT. Column-only; NOT NULL DEFAULT 0 backfills existing rows
-- to 0 (they predate throughput capture). No RLS surface change.
-- ============================================================================

ALTER TABLE workflow_node_stats
  ADD COLUMN IF NOT EXISTS completed_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN workflow_node_stats.completed_count IS
  'Units that exited this node on snapshot_date (throughput), derived from workflow_runs by the node-stats cron. SUM over a date range = throughput for that range. 0 for rows written before this column existed.';
