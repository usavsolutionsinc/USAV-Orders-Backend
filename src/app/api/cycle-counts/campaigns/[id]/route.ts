import { NextRequest, NextResponse } from 'next/server';
import {
  assertPermission,
  PermissionDeniedError,
  permissionDeniedResponse,
} from '@/lib/auth/permissions';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/cycle-counts/campaigns/[id]?bin_id=
 *   Campaign header + filtered lines. Used by both the campaign manager
 *   page and the LocationDetailView's "active campaign" banner.
 *
 * PATCH /api/cycle-counts/campaigns/[id]
 *   Body: { action: 'close' | 'reopen', staffId } — close an open campaign, or
 *   reopen a mistakenly-closed one (closed → open). Counts are applied per-line
 *   at approve time, so reopen only flips the header status flag.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'cycle_count.view');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id: idRaw } = await params;
    const campaignId = Number(idRaw);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const binIdRaw = Number(searchParams.get('bin_id'));
    const binId = Number.isFinite(binIdRaw) && binIdRaw > 0 ? Math.floor(binIdRaw) : null;

    const c = await tenantQuery(
      orgId,
      `SELECT id, name, scope, variance_tol, status, created_by, created_at, closed_at
       FROM cycle_count_campaigns WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [campaignId, orgId],
    );
    if (c.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const lineParams: unknown[] = [campaignId, orgId];
    let binFilter = '';
    if (binId) {
      lineParams.push(binId);
      binFilter = `AND ccl.bin_id = $${lineParams.length}`;
    }

    // sku_stock is joined on the SKU string (collides across tenants) so it is
    // org-aligned to the line's own org.
    const linesRes = await tenantQuery(
      orgId,
      `SELECT ccl.id, ccl.bin_id, ccl.sku, ccl.expected_qty, ccl.counted_qty,
              ccl.variance, ccl.status, ccl.counted_by, ccl.counted_at,
              ccl.approved_by, ccl.approved_at, ccl.notes, ccl.updated_at,
              l.barcode AS bin_barcode, l.name AS bin_name,
              l.row_label, l.col_label, l.room,
              COALESCE(
                NULLIF(ss.display_name_override, ''),
                NULLIF(ss.product_title, '')
              ) AS product_title
       FROM cycle_count_lines ccl
       JOIN locations l ON l.id = ccl.bin_id
       LEFT JOIN sku_stock ss ON ss.sku = ccl.sku AND ss.organization_id = ccl.organization_id
       WHERE ccl.campaign_id = $1 AND ccl.organization_id = $2 ${binFilter}
       ORDER BY l.room NULLS LAST, l.row_label NULLS LAST, l.col_label NULLS LAST, ccl.sku`,
      lineParams,
    );

    return NextResponse.json({
      success: true,
      campaign: c.rows[0],
      lines: linesRes.rows,
    });
  } catch (err: any) {
    console.error('[GET /api/cycle-counts/campaigns/[id]] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to load campaign' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // cycle_count.approve is on STEP_UP_PERMISSIONS — closing/approving a
    // campaign requires a fresh step-up grant via requireRoutePerm.
    const gate = await requireRoutePerm(request, 'cycle_count.approve');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id: idRaw } = await params;
    const campaignId = Number(idRaw);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '').trim();
    const staffId =
      Number.isFinite(Number(body?.staffId)) && Number(body?.staffId) > 0
        ? Math.floor(Number(body?.staffId))
        : null;

    try {
      await assertPermission(staffId, 'cycle_count.approve');
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        return NextResponse.json(permissionDeniedResponse(err), { status: 403 });
      }
      throw err;
    }

    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 });
    }
    if (action !== 'close' && action !== 'reopen') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
    if (action === 'close') {
      const r = await tenantQuery<{ id: number }>(
        orgId,
        `UPDATE cycle_count_campaigns
         SET status = 'closed', closed_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'open'
         RETURNING id`,
        [campaignId, orgId],
      );
      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Already closed or not found' }, { status: 409 });
      }
    } else {
      // reopen — the inverse of close (closed → open, clear closed_at) so a
      // campaign closed by mistake can take counts again. Guarded on status so a
      // double-reopen is a clean 409, mirroring close.
      const r = await tenantQuery<{ id: number }>(
        orgId,
        `UPDATE cycle_count_campaigns
         SET status = 'open', closed_at = NULL
         WHERE id = $1 AND organization_id = $2 AND status = 'closed'
         RETURNING id`,
        [campaignId, orgId],
      );
      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Not closed or not found' }, { status: 409 });
      }
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[PATCH /api/cycle-counts/campaigns/[id]] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to update campaign' },
      { status: 500 },
    );
  }
}
