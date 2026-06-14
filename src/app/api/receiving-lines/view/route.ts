import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/receiving-lines/view
 * Record that the current operator OPENED a receiving line in the workspace —
 * upserts receiving_line_views so the unbox sidebar's "Viewed" pill can list
 * each staff member's recently-opened lines (newest first), per-staff and
 * cross-device. Fire-and-forget from the client; failures are non-fatal.
 *
 * Body: { receiving_line_id: number, receiving_id?: number | null }
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const staffId = Number(ctx?.staffId);
    const orgId = ctx?.organizationId;
    if (!Number.isFinite(staffId) || staffId <= 0 || !orgId) {
      // No identifiable viewer — silently no-op (recents are best-effort).
      return NextResponse.json({ success: true, recorded: false });
    }

    const body = await request.json().catch(() => ({}));
    const lineId = Number((body as Record<string, unknown>)?.receiving_line_id);
    if (!Number.isFinite(lineId) || lineId <= 0) {
      return NextResponse.json(
        { success: false, error: 'receiving_line_id is required' },
        { status: 400 },
      );
    }
    const rawRecv = Number((body as Record<string, unknown>)?.receiving_id);
    const receivingId = Number.isFinite(rawRecv) && rawRecv > 0 ? rawRecv : null;

    await pool.query(
      `INSERT INTO receiving_line_views (organization_id, staff_id, receiving_line_id, receiving_id, viewed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (organization_id, staff_id, receiving_line_id)
       DO UPDATE SET viewed_at = NOW(),
                     receiving_id = COALESCE(EXCLUDED.receiving_id, receiving_line_views.receiving_id)`,
      [orgId, staffId, lineId, receivingId],
    );

    return NextResponse.json({ success: true, recorded: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record view';
    console.error('receiving-lines/view POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
});
