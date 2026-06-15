import { NextRequest, NextResponse } from 'next/server';
import {
  assertPermission,
  PermissionDeniedError,
  permissionDeniedResponse,
} from '@/lib/auth/permissions';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

/**
 * GET /api/cycle-counts/campaigns?status=open
 *   List campaigns with progress counters.
 *
 * POST /api/cycle-counts/campaigns
 *   Create a new campaign + snapshot current bin_contents into cycle_count_lines.
 *   Body: { name, scope?, varianceTol?, staffId }
 *   scope.binIds?: number[]      — only count these bin ids
 *   scope.rooms?: string[]       — only count bins in these rooms
 *   scope.minAgeDays?: number    — only count rows not counted in N days
 */

export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const params: string[] = [];
    const clauses: string[] = [];
    // Tenant ownership filter — never list another org's campaigns.
    params.push(ctx.organizationId);
    clauses.push(`c.organization_id = $${params.length}`);
    if (status === 'open' || status === 'closed') {
      params.push(status);
      clauses.push(`c.status = $${params.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const r = await tenantQuery(
      ctx.organizationId,
      `SELECT c.id, c.name, c.scope, c.variance_tol, c.status, c.created_by, c.created_at, c.closed_at,
              COUNT(l.*) FILTER (WHERE l.status = 'pending')::int        AS pending_lines,
              COUNT(l.*) FILTER (WHERE l.status = 'counted')::int        AS counted_lines,
              COUNT(l.*) FILTER (WHERE l.status = 'pending_review')::int AS review_lines,
              COUNT(l.*) FILTER (WHERE l.status = 'approved')::int       AS approved_lines,
              COUNT(l.*) FILTER (WHERE l.status = 'rejected')::int       AS rejected_lines,
              COUNT(l.*)::int                                            AS total_lines
       FROM cycle_count_campaigns c
       LEFT JOIN cycle_count_lines l ON l.campaign_id = c.id
       ${where}
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT 100`,
      params,
    );
    return NextResponse.json({ success: true, campaigns: r.rows });
  } catch (err: any) {
    console.error('[GET /api/cycle-counts/campaigns] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to list campaigns' },
      { status: 500 },
    );
  }
}, { permission: 'cycle_count.view' });

export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    const varianceTol = Number(body?.varianceTol);
    const staffId =
      Number.isFinite(Number(body?.staffId)) && Number(body?.staffId) > 0
        ? Math.floor(Number(body?.staffId))
        : null;
    const scope = body?.scope && typeof body.scope === 'object' ? body.scope : {};

    // Permission: any non-readonly staff can kick off a count.
    try {
      await assertPermission(staffId, 'bin.set');
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return NextResponse.json(permissionDeniedResponse(err), { status: 403 });
      }
      throw err;
    }

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const tol =
      Number.isFinite(varianceTol) && varianceTol >= 0 && varianceTol <= 1
        ? varianceTol
        : 0.05;

    // Build the snapshot filter from scope.
    const filterClauses: string[] = ['true'];
    const filterParams: unknown[] = [];
    const binIds = Array.isArray(scope?.binIds)
      ? scope.binIds.filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v))
      : null;
    const rooms = Array.isArray(scope?.rooms)
      ? scope.rooms.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '').map((r: string) => r.trim())
      : null;
    const minAgeDays =
      Number.isFinite(Number(scope?.minAgeDays)) && Number(scope?.minAgeDays) > 0
        ? Math.floor(Number(scope.minAgeDays))
        : null;

    if (binIds && binIds.length > 0) {
      filterParams.push(binIds);
      filterClauses.push(`bc.location_id = ANY($${filterParams.length}::int[])`);
    }
    if (rooms && rooms.length > 0) {
      filterParams.push(rooms);
      filterClauses.push(`l.room = ANY($${filterParams.length}::text[])`);
    }
    if (minAgeDays != null) {
      filterParams.push(minAgeDays);
      filterClauses.push(
        `(bc.last_counted IS NULL OR bc.last_counted < NOW() - INTERVAL '1 day' * $${filterParams.length})`,
      );
    }

    return await withTenantTransaction(orgId, async (client) => {
      const insCampaign = await client.query<{ id: number }>(
        `INSERT INTO cycle_count_campaigns (name, scope, variance_tol, status, created_by, organization_id)
         VALUES ($1, $2::jsonb, $3, 'open', $4, $5)
         RETURNING id`,
        [name, JSON.stringify(scope ?? {}), tol, staffId, orgId],
      );
      const campaignId = insCampaign.rows[0].id;
      filterParams.unshift(campaignId);
      // org param goes LAST (outside the renumber regex, which only bumps the
      // scope-filter placeholders). It scopes the snapshot to this org's bins
      // and stamps every snapshotted line.
      filterParams.push(orgId);
      const orgIdx = filterParams.length;

      // Snapshot bin_contents → cycle_count_lines (this org's bins only).
      const inserted = await client.query<{ inserted: number }>(
        `WITH snapshot AS (
           SELECT bc.location_id, bc.sku, bc.qty
           FROM bin_contents bc
           JOIN locations l ON l.id = bc.location_id
           WHERE ${filterClauses.join(' AND ').replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + 1}`)}
             AND bc.organization_id = $${orgIdx}
         ),
         ins AS (
           INSERT INTO cycle_count_lines (campaign_id, bin_id, sku, expected_qty, organization_id)
           SELECT $1, location_id, sku, qty, $${orgIdx}
           FROM snapshot
           ON CONFLICT (campaign_id, bin_id, sku) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS inserted FROM ins`,
        filterParams,
      );
      return NextResponse.json({
        success: true,
        campaign: { id: campaignId },
        lines_snapshotted: inserted.rows[0]?.inserted ?? 0,
      });
    });
  } catch (err: any) {
    console.error('[POST /api/cycle-counts/campaigns] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to create campaign' },
      { status: 500 },
    );
  }
}, { permission: 'cycle_count.view' });
