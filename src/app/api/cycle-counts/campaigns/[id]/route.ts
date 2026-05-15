import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  assertPermission,
  PermissionDeniedError,
  permissionDeniedResponse,
} from '@/lib/auth/permissions';

/**
 * GET /api/cycle-counts/campaigns/[id]?bin_id=
 *   Campaign header + filtered lines. Used by both the campaign manager
 *   page and the LocationDetailView's "active campaign" banner.
 *
 * PATCH /api/cycle-counts/campaigns/[id]
 *   Body: { action: 'close', staffId } — closes an open campaign.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await params;
    const campaignId = Number(idRaw);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const binIdRaw = Number(searchParams.get('bin_id'));
    const binId = Number.isFinite(binIdRaw) && binIdRaw > 0 ? Math.floor(binIdRaw) : null;

    const c = await pool.query(
      `SELECT id, name, scope, variance_tol, status, created_by, created_at, closed_at
       FROM cycle_count_campaigns WHERE id = $1 LIMIT 1`,
      [campaignId],
    );
    if (c.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const lineParams: unknown[] = [campaignId];
    let binFilter = '';
    if (binId) {
      lineParams.push(binId);
      binFilter = `AND ccl.bin_id = $${lineParams.length}`;
    }

    const linesRes = await pool.query(
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
       LEFT JOIN sku_stock ss ON ss.sku = ccl.sku
       WHERE ccl.campaign_id = $1 ${binFilter}
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
    if (action !== 'close') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
    const r = await pool.query<{ id: number }>(
      `UPDATE cycle_count_campaigns
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1 AND status = 'open'
       RETURNING id`,
      [campaignId],
    );
    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Already closed or not found' }, { status: 409 });
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
