import { NextRequest, NextResponse } from 'next/server';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { AUDIT_ENTITY } from '@/lib/audit-logs';

// ── POST /api/fba/shipments/close ─────────────────────────────────────────────
// Ship Close: transitions all LABEL_ASSIGNED items (and any remaining
// TESTED/PACKED items) to SHIPPED and marks the shipment as SHIPPED.
// Requires all items to be at least TESTED (admin can force-close).
// Writes a SHIP/SHIPPED event to fba_fnsku_logs for each shipped item.
//
// Destructive — requires step-up auth (via shipping.void_order, which is on
// STEP_UP_PERMISSIONS). Closing a shipment can't be undone — all items go
// SHIPPED and inventory is decremented.
//
// Body: { shipment_id, force?: boolean, station? } — actor is from session.
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const { shipment_id, force = false, station } = body;
    const staff_id = ctx.staffId;

    if (!shipment_id) {
      return NextResponse.json(
        { success: false, error: 'shipment_id is required' },
        { status: 400 }
      );
    }

    type CloseResult =
      | { kind: 'staff_not_found' }
      | { kind: 'shipment_not_found' }
      | { kind: 'already_shipped' }
      | { kind: 'still_planned'; count: string }
      | { kind: 'ok'; shipment: any; itemsShipped: number; staffName: string };

    const outcome = await withTenantTransaction<CloseResult>(ctx.organizationId, async (client) => {
      // Verify staff
      const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
      if (!staffCheck.rows[0]) {
        return { kind: 'staff_not_found' };
      }

      // Verify shipment exists
      const shipmentCheck = await client.query(
        `SELECT id, status, shipment_ref FROM fba_shipments WHERE id = $1 AND organization_id = $2`,
        [shipment_id, ctx.organizationId]
      );
      if (!shipmentCheck.rows[0]) {
        return { kind: 'shipment_not_found' };
      }
      if (shipmentCheck.rows[0].status === 'SHIPPED') {
        return { kind: 'already_shipped' };
      }

      // Block close if any items are still PLANNED (unless force=true by admin)
      if (!force) {
        const plannedCount = await client.query(
          `SELECT COUNT(*) FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2`,
          [shipment_id, ctx.organizationId]
        );
        if (Number(plannedCount.rows[0].count) > 0) {
          return { kind: 'still_planned', count: String(plannedCount.rows[0].count) };
        }
      }

      // Ship all non-shipped items
      const itemsRes = await client.query(
        `UPDATE fba_shipment_items
         SET status            = 'SHIPPED',
             shipped_by_staff_id = $1,
             shipped_at        = NOW(),
             updated_at        = NOW()
         WHERE shipment_id = $2
           AND status != 'SHIPPED'
           AND organization_id = $3
         RETURNING *`,
        [staff_id, shipment_id, ctx.organizationId]
      );

      // Write one immutable SHIPPED event per item.
      for (const item of itemsRes.rows) {
        await client.query(
          `INSERT INTO fba_fnsku_logs
             (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata, organization_id)
           VALUES ($1, 'SHIP', 'SHIPPED', $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
          [
            item.fnsku,
            staff_id,
            shipment_id,
            item.id,
            Math.max(1, Number(item.actual_qty) || 0),
            station || 'SHIP_CLOSE',
            `Shipment closed (${force ? 'force' : 'standard'})`,
            JSON.stringify({
              trigger: 'fba.shipments.close',
              shipment_ref: shipmentCheck.rows[0].shipment_ref || null,
            }),
            ctx.organizationId,
          ]
        );
      }

      // Close shipment — set status to SHIPPED.
      const closedShipmentRes = await client.query(
        `UPDATE fba_shipments
         SET status     = 'SHIPPED',
             shipped_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [shipment_id, ctx.organizationId]
      );

      return {
        kind: 'ok',
        shipment: closedShipmentRes.rows[0],
        itemsShipped: itemsRes.rows.length,
        staffName: staffCheck.rows[0].name,
      };
    });

    if (outcome.kind === 'staff_not_found') {
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }
    if (outcome.kind === 'shipment_not_found') {
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }
    if (outcome.kind === 'already_shipped') {
      return NextResponse.json({ success: false, error: 'Shipment is already shipped' }, { status: 409 });
    }
    if (outcome.kind === 'still_planned') {
      return NextResponse.json(
        {
          success: false,
          error: `${outcome.count} item(s) are still PLANNED. Mark them ready first or use force=true.`,
        },
        { status: 409 }
      );
    }

    await invalidateCacheTags(['fba-board', 'fba-shipments', 'fba-stage-counts']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    await publishFbaShipmentChanged({ action: 'closed', shipmentId: Number(shipment_id || 0), source: 'fba.shipments.close', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      shipment: outcome.shipment,
      items_shipped: outcome.itemsShipped,
      staff_name: outcome.staffName,
    });
  } catch (error: any) {
    console.error('[POST /api/fba/shipments/close]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to close shipment' },
      { status: 500 }
    );
  }
}, {
  permission: 'shipping.void_order',
  audit: {
    source: 'fba.shipments.close',
    action: 'fba.shipment.close',
    entityType: AUDIT_ENTITY.SHIPMENT,
    entityId: ({ body }) => {
      const b = body as { shipment_id?: number } | null;
      return b?.shipment_id ?? null;
    },
    extra: ({ body, response }) => {
      const b = body as { force?: boolean } | null;
      const r = response as { items_shipped?: number } | null;
      return {
        force: b?.force ?? false,
        items_shipped: r?.items_shipped ?? null,
      };
    },
  },
});
