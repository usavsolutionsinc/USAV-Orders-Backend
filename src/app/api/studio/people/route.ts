import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { db } from '@/lib/drizzle/db';
import { tenantQuery } from '@/lib/tenancy/db';
import { workflowDefinitions, workflowNodes } from '@/lib/drizzle/schema';
import {
  assemblePeopleCoverage,
  type StaffStationAssignment,
} from '@/lib/studio/people-coverage';
import { asStation } from '@/lib/neon/staff-stations-queries';

/**
 * GET /api/studio/people?v=<definitionId>
 *
 * The People lens feed (Studio ST6 / Phase E1): per-node staffing coverage for
 * one workflow definition. For each process node it returns the staff scoped to
 * that node's STATION — derived by mapping node.config.station (the
 * operations-catalog department key) through the crosswalk in
 * src/lib/studio/people-coverage.ts to the staff_stations enum, then joining the
 * org's staff↔station assignments.
 *
 * Strictly READ-ONLY (Studio law #7): it reads staff access; the Studio UI
 * deep-links to the staff editor. This route never writes a grant. One grouped
 * read of staff_stations + a node-id/config read; no polling on the client
 * (fetch-on-activation), mirroring /api/studio/live's org-scoped resolution.
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (request, ctx) => {
    const vRaw = request.nextUrl.searchParams.get('v');
    const v = vRaw ? Number(vRaw) : null;
    if (vRaw && (!Number.isFinite(v) || (v ?? 0) <= 0)) {
      return NextResponse.json({ ok: false, error: 'invalid v' }, { status: 400 });
    }

    try {
      // Resolve the definition org-scoped (default: the active one) — same
      // parent-verification as /api/studio/live (a cross-tenant ?v= finds no row).
      const [definition] = await db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.organizationId, ctx.organizationId),
            v ? eq(workflowDefinitions.id, v) : eq(workflowDefinitions.isActive, true),
          ),
        )
        .limit(1);

      if (!definition) {
        return NextResponse.json({ ok: true, nodes: {}, totalCovering: 0, uncoveredNodeIds: [] });
      }

      // The graph's nodes (id + department key from config.station).
      const nodeRows = await db
        .select({ id: workflowNodes.id, config: workflowNodes.config })
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowDefinitionId, definition.id));

      const nodes = nodeRows.map((n) => {
        const config = (n.config ?? {}) as Record<string, unknown>;
        const station = config.station != null ? String(config.station) : null;
        return { id: n.id, station };
      });

      // All staff↔station assignments for this org. `staff_stations` has no
      // organization_id column → scope via its `staff` parent (same pattern as
      // staff-stations-queries.ts). Only active staff are surfaced.
      const r = await tenantQuery(
        ctx.organizationId,
        `SELECT s.id AS staff_id, s.name, s.role, ss.station, ss.is_primary
           FROM staff_stations ss
           JOIN staff s ON s.id = ss.staff_id
          WHERE s.organization_id = $1
            AND COALESCE(s.active, true) = true
          ORDER BY ss.station ASC, ss.is_primary DESC, s.name ASC`,
        [ctx.organizationId],
      );

      const assignments: StaffStationAssignment[] = [];
      for (const row of r.rows) {
        const station = asStation(row.station);
        if (!station) continue; // ignore any out-of-enum legacy value
        assignments.push({
          staffId: Number(row.staff_id),
          name: String(row.name ?? ''),
          role: row.role != null ? String(row.role) : null,
          station,
          isPrimary: Boolean(row.is_primary),
        });
      }

      const result = assemblePeopleCoverage({ nodes, assignments });
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio people failed';
      console.error('[GET /api/studio/people] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view', feature: 'studio' },
);
