-- ============================================================================
-- 2026-06-12: definition+status index on item_workflow_state
-- ============================================================================
-- The Studio Live feed (/api/studio/live) and the daily workflow-node-stats
-- snapshot both lead with WHERE workflow_definition_id = $1 AND status <> 'done'.
-- Existing indexes only cover serial_unit_id and organization_id, so those
-- queries scanned the whole table — and 'done' rows accrue forever (runs are
-- never deleted). Flagged by the neon-cost review of ST2.

CREATE INDEX IF NOT EXISTS idx_item_workflow_state_definition_status
  ON item_workflow_state (workflow_definition_id, status);
