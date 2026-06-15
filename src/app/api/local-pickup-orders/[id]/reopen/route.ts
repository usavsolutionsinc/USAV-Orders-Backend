import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * POST /api/local-pickup-orders/[id]/reopen — reverse of void.
 *
 * Brings a VOIDED order back to DRAFT (clearing voided_at/voided_by) so it
 * re-enters the editable flow (finalize/complete act on DRAFT). Same
 * `orders.void` permission as void — they're inverse mutations of one action.
 *
 * Only reopens orders that were never finalized (`completed_at IS NULL`): void
 * accepts ANY non-VOIDED status including COMPLETED, but drafting a
 * once-completed order would let finalize mint a SECOND Zoho PO (it still
 * carries its zoho_po_id/completed_at). Such an order is refused (404) — a
 * completed-then-voided order is not a reopen-to-draft case.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRoutePerm(req, 'orders.void');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const result = await tenantQuery(
      orgId,
      `UPDATE local_pickup_orders
       SET status = 'DRAFT', voided_by = NULL, voided_at = NULL, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND status = 'VOIDED' AND completed_at IS NULL
       RETURNING *`,
      [orderId, orgId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Order not found, not VOIDED, or was already completed (a finalized order cannot be reopened to draft)',
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][reopen]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to reopen order' },
      { status: 500 },
    );
  }
}
