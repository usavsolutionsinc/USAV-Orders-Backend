import { NextRequest, NextResponse } from 'next/server';
import { parseFbaPlanId } from '@/lib/fba/plan-id';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { requireRoutePerm, recordRouteAudit } from '@/lib/auth/dynamic-route-guard';
import { withTenantTransaction } from '@/lib/tenancy/db';

type Params = Promise<{ id: string; itemId: string }>;

/**
 * PATCH /api/fba/shipments/[id]/items/[itemId]/reassign
 *
 * Moves an item from its current shipment to a different shipment.
 * Body: { target_shipment_id: number }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id, itemId } = await params;
    const sourceShipmentId = parseFbaPlanId(id);
    const itemIdNum = Number(itemId);

    if (sourceShipmentId == null || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid shipment or item ID' }, { status: 400 });
    }

    const body = await request.json();
    const targetShipmentId = Number(body.target_shipment_id);
    if (!Number.isFinite(targetShipmentId) || targetShipmentId <= 0) {
      return NextResponse.json({ success: false, error: 'target_shipment_id is required' }, { status: 400 });
    }
    if (targetShipmentId === sourceShipmentId) {
      return NextResponse.json({ success: false, error: 'Item is already in this shipment' }, { status: 400 });
    }

    const outcome = await withTenantTransaction(orgId, async (client) => {
      // Verify item exists in source
      const item = await client.query(
        `SELECT id, fnsku, status FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2 AND organization_id = $3`,
        [itemIdNum, sourceShipmentId, orgId],
      );
      if (!item.rows[0]) {
        return { error: 'Item not found in source shipment', status: 404 as const };
      }

      // Verify target shipment exists and is not shipped
      const target = await client.query(
        `SELECT id, status FROM fba_shipments WHERE id = $1 AND organization_id = $2`,
        [targetShipmentId, orgId],
      );
      if (!target.rows[0]) {
        return { error: 'Target shipment not found', status: 404 as const };
      }
      if (target.rows[0].status === 'SHIPPED') {
        return { error: 'Cannot move items to a shipped shipment', status: 409 as const };
      }

      // Move the item
      await client.query(
        `UPDATE fba_shipment_items SET shipment_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
        [targetShipmentId, itemIdNum, orgId],
      );

      // Touch updated_at on both shipments so real-time listeners pick up the change
      await client.query(`UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1 AND organization_id = $2`, [sourceShipmentId, orgId]);
      await client.query(`UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1 AND organization_id = $2`, [targetShipmentId, orgId]);

      return { ok: true as const };
    });

    if ('error' in outcome) {
      return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    }

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await publishFbaItemChanged({ action: 'reassign', shipmentId: Number(targetShipmentId || 0), itemId: Number(itemId), source: 'fba.shipments.items.reassign', organizationId: gate.ctx.organizationId });

    return NextResponse.json({ success: true, moved: { item_id: itemIdNum, from: sourceShipmentId, to: targetShipmentId } });
  } catch (error: any) {
    console.error('[PATCH /api/fba/shipments/[id]/items/[itemId]/reassign]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to reassign item' },
      { status: 500 },
    );
  }
}
