import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/workflow/flow-audit?days=90
 *
 * Read-only "how does information actually move through the system" feed for
 * the Operations canvas. It does NOT use the new workflow engine — it derives a
 * flow graph straight from the REAL item lifecycle so the flow can be audited
 * and improved before any workflow is wired live:
 *
 *   nodes  — every serial_status the units currently sit in, with live counts
 *            (serial_units.current_status). These are the lifecycle states.
 *   edges  — observed transitions (inventory_events.prev_status → next_status)
 *            with counts + most-recent timestamp. These are the real movements;
 *            a fat RECEIVED→ON_HOLD edge is a bottleneck you can see.
 *
 * The window (?days, default 90) bounds the edge aggregation so the picture
 * reflects current operations, not all-time history. Node occupancy is always
 * the live snapshot.
 *
 * Reads on every request — fine for a low-traffic admin tool.
 */
export const dynamic = 'force-dynamic';

interface FlowNode {
  status: string;
  count: number;
}
interface FlowEdge {
  from: string;
  to: string;
  count: number;
  lastAt: string | null;
}

export const GET = withAuth(
  async (request) => {
    const daysRaw = Number(request.nextUrl.searchParams.get('days'));
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? Math.floor(daysRaw) : 90;

    try {
      // Live occupancy per lifecycle state.
      const nodesQ = await pool.query<{ status: string; count: number }>(
        `SELECT current_status::text AS status, COUNT(*)::int AS count
           FROM serial_units
          GROUP BY current_status
          ORDER BY count DESC`,
      );

      // Observed transitions within the window (the actual movements).
      const edgesQ = await pool.query<{
        from: string;
        to: string;
        count: number;
        lastAt: string | null;
      }>(
        `SELECT prev_status AS "from",
                next_status AS "to",
                COUNT(*)::int AS count,
                MAX(occurred_at) AS "lastAt"
           FROM inventory_events
          WHERE prev_status IS NOT NULL
            AND next_status IS NOT NULL
            AND prev_status <> next_status
            AND occurred_at > NOW() - ($1 || ' days')::interval
          GROUP BY prev_status, next_status
          ORDER BY count DESC`,
        [days],
      );

      // Event-type volume in the window — a coarse "where is the activity" read.
      const eventsQ = await pool.query<{ eventType: string; count: number }>(
        `SELECT event_type AS "eventType", COUNT(*)::int AS count
           FROM inventory_events
          WHERE occurred_at > NOW() - ($1 || ' days')::interval
          GROUP BY event_type
          ORDER BY count DESC`,
        [days],
      );

      const nodes: FlowNode[] = nodesQ.rows;
      const edges: FlowEdge[] = edgesQ.rows.map((e) => ({
        from: e.from,
        to: e.to,
        count: e.count,
        lastAt: e.lastAt ? new Date(e.lastAt).toISOString() : null,
      }));

      const totalUnits = nodes.reduce((sum, n) => sum + n.count, 0);
      const totalTransitions = edges.reduce((sum, e) => sum + e.count, 0);

      return NextResponse.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        windowDays: days,
        nodes,
        edges,
        eventVolume: eventsQ.rows,
        totals: { units: totalUnits, transitions: totalTransitions },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'flow-audit failed';
      console.error('[GET /api/workflow/flow-audit] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'admin.view' },
);
