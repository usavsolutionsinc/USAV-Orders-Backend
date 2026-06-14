-- ============================================================================
-- 2026-06-11c: target-side index on workflow_edges
-- ============================================================================
-- The Phase-1 tap's entry-node lookup (src/lib/workflow/tap.ts findEntryNode)
-- finds "nodes with no inbound edges" via NOT EXISTS (… WHERE target_node = n.id).
-- The only existing edge index is source-side (idx_workflow_edges_source), so
-- that predicate scanned every edge row of the definition per candidate node.
-- Runs on every first-scan enrollment; cheap today, linear-growth otherwise.
-- (Flagged by the neon-cost review of the Phase-1 engine tap.)

CREATE INDEX IF NOT EXISTS idx_workflow_edges_target
  ON workflow_edges (workflow_definition_id, target_node);
