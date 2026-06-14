/**
 * Workflow node stats — the daily queue-depth snapshot job.
 *
 * Freezes per-(definition, node) WIP counts from item_workflow_state into
 * workflow_node_stats so the Studio's Flow² lens has trend history (queue
 * growth, aging) that a point-in-time query can't reconstruct. Idempotent:
 * re-running on the same day overwrites that day's row (ON CONFLICT on the
 * (definition, node, snapshot_date) unique index).
 *
 * Time-in-node medians/percentiles deliberately do NOT live here — they are
 * derivable from workflow_runs at read time.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';

export interface NodeStatsSnapshotResult {
  success: boolean;
  rowsWritten: number;
}

export async function runWorkflowNodeStatsSnapshot(): Promise<NodeStatsSnapshotResult> {
  const res = await db.execute(sql`
    INSERT INTO workflow_node_stats
      (organization_id, workflow_definition_id, node_id, snapshot_date,
       queue_depth, blocked_count, error_count, oldest_entered_at)
    SELECT s.organization_id,
           s.workflow_definition_id,
           s.current_node_id,
           CURRENT_DATE,
           COUNT(*) FILTER (WHERE s.status IN ('active', 'blocked'))::int,
           COUNT(*) FILTER (WHERE s.status = 'blocked')::int,
           COUNT(*) FILTER (WHERE s.status = 'error')::int,
           MIN(s.entered_node_at) FILTER (WHERE s.status IN ('active', 'blocked'))
      FROM item_workflow_state s
     WHERE s.status <> 'done'
     GROUP BY s.organization_id, s.workflow_definition_id, s.current_node_id
    ON CONFLICT (workflow_definition_id, node_id, snapshot_date)
    DO UPDATE SET queue_depth       = EXCLUDED.queue_depth,
                  blocked_count     = EXCLUDED.blocked_count,
                  error_count       = EXCLUDED.error_count,
                  oldest_entered_at = EXCLUDED.oldest_entered_at
    RETURNING id
  `);
  return { success: true, rowsWritten: res.rows.length };
}
