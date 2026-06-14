import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import pool from '@/lib/db';

/**
 * GET /api/orders/[id]/timeline — the order's event trail from `audit_logs`
 * (tracking added, label printed, packed, shipped, edits…), newest first.
 * Feeds the shared `EventTimeline` in the order details panel via
 * `orderAuditToTimeline`. Read-only; gated by `orders.view`.
 *
 * Matches on `lower(entity_type) = 'order'` since callers historically wrote the
 * uppercase 'ORDER' literal while AUDIT_ENTITY.ORDER is 'order'.
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'orders.view');
    if (gate.denied) return gate.denied;

    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT al.id, al.created_at, al.action, al.after_data, al.metadata, s.name AS actor_name
         FROM audit_logs al
         LEFT JOIN staff s ON s.id = al.actor_staff_id
        WHERE lower(al.entity_type) = 'order' AND al.entity_id = $1
        ORDER BY al.created_at DESC
        LIMIT 200`,
      [String(id)],
    );

    return NextResponse.json({ success: true, events: result.rows });
  } catch (error: any) {
    console.error('[GET /api/orders/[id]/timeline] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order timeline', details: error?.message },
      { status: 500 },
    );
  }
}
