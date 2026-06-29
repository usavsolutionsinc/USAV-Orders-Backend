import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantDrizzle } from '@/lib/drizzle/tenant-db';
import { workflowDefinitions } from '@/lib/drizzle/schema';
import {
  assembleFlowMetrics,
  type DwellByType,
  type PortCount,
  type WipSnapshot,
  type FlowNodeRef,
  type FlowEdgeRef,
} from '@/lib/studio/flow-metrics';

/**
 * GET /api/studio/flow?v=<definitionId>&window=<days>
 *
 * The Flow² lens feed — TREND/THROUGHPUT over a definition (vs /live's
 * point-in-time occupancy):
 *   - time-in-node median/p90 per node_type (lag() over each unit's runs)
 *   - output-port distribution + fail-rate per node_type
 *   - WIP trend per node from the daily workflow_node_stats snapshots
 *   - a ranked bottleneck list
 *
 * Tenancy: the definition is resolved org-scoped (parent-verification, same as
 * /live); workflow_runs is additionally filtered by organization_id (it carries
 * the column). nodes/edges inherit tenant scope via the org-verified definition.
 * Read via fetch-on-lens-activation (no polling — Studio law #4); the data
 * changes at most daily (snapshot cron) so there is nothing to poll.
 */
export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? '');
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export const GET = withAuth(
  async (request, ctx) => {
    const vRaw = request.nextUrl.searchParams.get('v');
    const v = vRaw ? Number(vRaw) : null;
    if (vRaw && (!Number.isFinite(v) || (v ?? 0) <= 0)) {
      return NextResponse.json({ ok: false, error: 'invalid v' }, { status: 400 });
    }
    const windowRaw = Number(request.nextUrl.searchParams.get('window'));
    const windowDays =
      Number.isFinite(windowRaw) && windowRaw > 0 && windowRaw <= 90 ? Math.floor(windowRaw) : 30;

    try {
      const org = ctx.organizationId;

      // GUC-scoped (RLS-ready): workflow_runs + workflow_node_stats are
      // FORCE-slated, so every read runs on a GUC-bearing tenant connection.
      // workflow_nodes/edges (no org column) are parent-verified via the
      // org-scoped definition; running them on the same connection is harmless.
      const result = await withTenantDrizzle(org, async (tx) => {
        const [definition] = await tx
          .select({ id: workflowDefinitions.id })
          .from(workflowDefinitions)
          .where(
            and(
              eq(workflowDefinitions.organizationId, org),
              v ? eq(workflowDefinitions.id, v) : eq(workflowDefinitions.isActive, true),
            ),
          )
          .limit(1);

        if (!definition) {
          return { ok: true, windowDays, nodes: {}, edges: {}, bottlenecks: [] };
        }
        const defId = definition.id;

        // Graph topology (parent-verified via the org-scoped definition above).
        const nodesRes = await tx.execute(
          sql`SELECT id, type FROM workflow_nodes WHERE workflow_definition_id = ${defId}`,
        );
        const nodes: FlowNodeRef[] = (nodesRes.rows as Row[]).map((r) => ({
          id: str(r.id),
          type: str(r.type),
        }));

        const edgesRes = await tx.execute(
          sql`SELECT id, source_node, source_port, target_node
                FROM workflow_edges WHERE workflow_definition_id = ${defId}`,
        );
        const edges: FlowEdgeRef[] = (edgesRes.rows as Row[]).map((r) => ({
          id: str(r.id),
          source: str(r.source_node),
          sourcePort: str(r.source_port),
          target: str(r.target_node),
        }));

        // Time-in-node: for each unit, the gap from the previous node's run to
        // this node's run is the dwell at this node (duration_ms is node
        // EXECUTION time, ~0ms, not dwell — so we use the inter-run gap).
        const dwellRes = await tx.execute(sql`
          WITH runs AS (
            SELECT node_type,
                   EXTRACT(EPOCH FROM (
                     created_at - lag(created_at) OVER (PARTITION BY serial_unit_id ORDER BY created_at, id)
                   )) AS dwell_s
              FROM workflow_runs
             WHERE workflow_definition_id = ${defId}
               AND organization_id = ${org}::uuid
               AND created_at >= now() - make_interval(days => ${windowDays})
          )
          SELECT node_type,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY dwell_s) AS median_s,
                 percentile_cont(0.9) WITHIN GROUP (ORDER BY dwell_s) AS p90_s,
                 count(dwell_s)::int AS samples
            FROM runs
           WHERE dwell_s IS NOT NULL AND dwell_s >= 0
           GROUP BY node_type
        `);
        const dwellByType: DwellByType[] = (dwellRes.rows as Row[]).map((r) => ({
          nodeType: str(r.node_type),
          medianS: numOrNull(r.median_s),
          p90S: numOrNull(r.p90_s),
          samples: num(r.samples),
        }));

        const portRes = await tx.execute(sql`
          SELECT node_type, output, count(*)::int AS n
            FROM workflow_runs
           WHERE workflow_definition_id = ${defId}
             AND organization_id = ${org}::uuid
             AND created_at >= now() - make_interval(days => ${windowDays})
           GROUP BY node_type, output
        `);
        const portCounts: PortCount[] = (portRes.rows as Row[]).map((r) => ({
          nodeType: str(r.node_type),
          output: str(r.output),
          n: num(r.n),
        }));

        const wipRes = await tx.execute(sql`
          SELECT node_id, snapshot_date::text AS date, queue_depth, blocked_count, error_count
            FROM workflow_node_stats
           WHERE workflow_definition_id = ${defId}
             AND organization_id = ${org}::uuid
             AND snapshot_date >= CURRENT_DATE - ${windowDays}::int
           ORDER BY node_id, snapshot_date
        `);
        const wipSnapshots: WipSnapshot[] = (wipRes.rows as Row[]).map((r) => ({
          nodeId: str(r.node_id),
          date: str(r.date),
          queueDepth: num(r.queue_depth),
          blocked: num(r.blocked_count),
          error: num(r.error_count),
        }));

        return assembleFlowMetrics({
          nodes,
          edges,
          dwellByType,
          portCounts,
          wipSnapshots,
          windowDays,
        });
      });

      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio flow failed';
      console.error('[GET /api/studio/flow] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view', feature: 'studio' },
);
