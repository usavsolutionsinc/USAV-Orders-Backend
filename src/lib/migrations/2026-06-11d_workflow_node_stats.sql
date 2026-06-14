-- ============================================================================
-- 2026-06-11d: workflow_node_stats — daily per-node queue snapshots
-- ============================================================================
-- ST2 of the Operations Studio (docs/operations-studio/operations-studio-plan.md
-- §4): the Live lens reads item_workflow_state directly, but TRENDS (queue
-- growth, Flow² heat over weeks) need a time series. One row per
-- (definition, node, day), written by /api/cron/workflow-node-stats at 00:45
-- so bottleneck history accrues from day one even though the Flow² lens
-- itself ships later. Time-in-node medians come from workflow_runs at read
-- time — this table only freezes what a point-in-time query can't recover:
-- queue depth and age.

BEGIN;

CREATE TABLE IF NOT EXISTS workflow_node_stats (
  id                     SERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  workflow_definition_id INTEGER NOT NULL
                           REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  node_id                TEXT NOT NULL,
  snapshot_date          DATE NOT NULL,
  queue_depth            INTEGER NOT NULL DEFAULT 0,  -- active + blocked at snapshot time
  blocked_count          INTEGER NOT NULL DEFAULT 0,
  error_count            INTEGER NOT NULL DEFAULT 0,
  oldest_entered_at      TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workflow_node_stats IS
  'Daily per-node queue-depth snapshots for the Studio Flow² lens. Written by the workflow-node-stats cron; idempotent per (definition, node, day).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_node_stats_day
  ON workflow_node_stats (workflow_definition_id, node_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_workflow_node_stats_org_date
  ON workflow_node_stats (organization_id, snapshot_date DESC);

COMMIT;
