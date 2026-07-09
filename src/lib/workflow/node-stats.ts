/**
 * Workflow node stats — the daily queue-depth + throughput snapshot job.
 *
 * Freezes two things a point-in-time query can't reconstruct into
 * workflow_node_stats, one row per (definition, node, day):
 *   1. WIP  — queue_depth / blocked / error / oldest_entered_at, from the LIVE
 *             item_workflow_state (what's piled up right now).
 *   2. THROUGHPUT — completed_count: units that EXITED the node that day, from
 *             workflow_runs (what got DONE). This is the first-week ROI proof:
 *             SUM(completed_count) over a date range is that range's throughput,
 *             so week-over-week lift is queryable WITHOUT recomputing.
 *
 * Idempotent: re-running on the same day overwrites that day's WIP row and
 * re-finalizes the prior day's throughput (ON CONFLICT on the
 * (definition, node, snapshot_date) unique index).
 *
 * Time-in-node medians/percentiles deliberately do NOT live here — they are
 * derivable from workflow_runs at read time (see studio/flow-metrics.ts).
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/drizzle/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface NodeStatsSnapshotResult {
  success: boolean;
  /** WIP rows written/updated for today (item_workflow_state snapshot). */
  rowsWritten: number;
  /** Throughput rows finalized for the prior day (workflow_runs → completed_count). */
  completedRowsWritten: number;
}

/**
 * Snapshot per-(definition, node) queue depth + finalize prior-day throughput
 * into workflow_node_stats.
 *
 * Tenancy: this is an org-spanning daily cron aggregate — every statement groups
 * by the source org (item_workflow_state.organization_id / workflow_runs.
 * organization_id) and stamps each output row with that org, so no cross-tenant
 * data ever crosses (every row stays attributed to its owner). Passing `orgId`
 * narrows the snapshot to a single tenant; OMITTING it keeps the byte-identical
 * all-orgs behaviour the cron + verify-script callers rely on.
 *
 * Transport: this INTENTIONALLY runs on the stateless neon-http `db` (the owner
 * connection), NOT a GUC-scoped tenant connection — its production caller (the
 * daily cron) snapshots EVERY org in one INSERT…SELECT, which a single
 * `app.current_org` GUC cannot express. It is the one engine-table path
 * (item_workflow_state + workflow_runs read, workflow_node_stats write) that must
 * read/write across orgs, so it relies on the owner role's RLS bypass and must
 * not be tenant-scoped. (Phase C5 left it here deliberately.)
 *
 * Throughput derivation (completed_count):
 *   A workflow_runs row = one node EXECUTION, i.e. a unit advancing out of (=
 *   exiting) a node. workflow_runs records node_TYPE, not the canvas node_id, so
 *   we map type → instance by joining workflow_nodes on (definition, type) — the
 *   SAME fan-out convention studio/flow-metrics.ts uses (exact for the
 *   one-node-per-type seed graphs; multi-instance graphs over-attribute the
 *   type's completions to every instance, symmetric and documented). Runs with a
 *   NULL workflow_definition_id can't be mapped and are excluded.
 *
 *   Timing: the cron runs at 00:45, so "today" has barely begun — counting
 *   today's runs would capture ~nothing and lose the rest of the day. Instead we
 *   FINALIZE the day that just ended: count workflow_runs from CURRENT_DATE - 1
 *   and write them onto that day's (already-existing) WIP row. Each calendar
 *   day's throughput is therefore captured exactly once, on the following run,
 *   and the snapshot_date matches the day the work happened.
 */
export async function runWorkflowNodeStatsSnapshot(orgId?: OrgId): Promise<NodeStatsSnapshotResult> {
  // ── 1. WIP snapshot for TODAY (unchanged) — completed_count defaults to 0 on
  //    insert and is left untouched on conflict; it is finalized by the NEXT
  //    day's run via the throughput statement below. ─────────────────────────
  const wipOrgFilter = orgId ? sql`AND s.organization_id = ${orgId}::uuid` : sql``;
  const wip = await db.execute(sql`
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
       ${wipOrgFilter}
     GROUP BY s.organization_id, s.workflow_definition_id, s.current_node_id
    ON CONFLICT (workflow_definition_id, node_id, snapshot_date)
    DO UPDATE SET queue_depth       = EXCLUDED.queue_depth,
                  blocked_count     = EXCLUDED.blocked_count,
                  error_count       = EXCLUDED.error_count,
                  oldest_entered_at = EXCLUDED.oldest_entered_at
    RETURNING id
  `);

  // ── 2. THROUGHPUT finalize for the day that just ended (CURRENT_DATE - 1).
  //    completed_count = units that exited each node yesterday, from
  //    workflow_runs mapped node_type → node_id. Upserts onto yesterday's WIP
  //    row (DO UPDATE only completed_count, preserving its WIP columns); if no
  //    WIP row exists for a completion-only node, it inserts one (WIP cols
  //    default 0). ──────────────────────────────────────────────────────────
  const runOrgFilter = orgId ? sql`AND r.organization_id = ${orgId}::uuid` : sql``;
  const completed = await db.execute(sql`
    INSERT INTO workflow_node_stats
      (organization_id, workflow_definition_id, node_id, snapshot_date, completed_count)
    SELECT r.organization_id,
           r.workflow_definition_id,
           n.id,
           (CURRENT_DATE - 1),
           COUNT(*)::int
      FROM workflow_runs r
      JOIN workflow_nodes n
        ON n.workflow_definition_id = r.workflow_definition_id
       AND n.type = r.node_type
     WHERE r.workflow_definition_id IS NOT NULL
       AND r.created_at >= (CURRENT_DATE - 1)
       AND r.created_at <  CURRENT_DATE
       ${runOrgFilter}
     GROUP BY r.organization_id, r.workflow_definition_id, n.id
    ON CONFLICT (workflow_definition_id, node_id, snapshot_date)
    DO UPDATE SET completed_count = EXCLUDED.completed_count
    RETURNING id
  `);

  return {
    success: true,
    rowsWritten: wip.rows.length,
    completedRowsWritten: completed.rows.length,
  };
}
