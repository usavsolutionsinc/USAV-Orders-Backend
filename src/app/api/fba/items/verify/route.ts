import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { withAuth } from '@/lib/auth/withAuth';

// ── POST /api/fba/items/verify ────────────────────────────────────────────────
// Packer scans a TESTED item to mark it physically packed (TESTED → PACKED).
// PACKED items form the combiner's queue on the Combine sub-page. Records
// verified_by_staff_id + verified_at and writes to fba_fnsku_logs in the same
// transaction. (Combining under a label is a later step: PACKED → LABEL_ASSIGNED.)
//
// Body: { shipment_id, fnsku, station? } — actor is from the verified session.
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const { shipment_id, fnsku, station } = body;
    const staff_id = ctx.staffId;

    if (!shipment_id || !fnsku?.trim()) {
      return NextResponse.json(
        { success: false, error: 'shipment_id and fnsku are required' },
        { status: 400 }
      );
    }
    const normalizedFnsku = String(fnsku).trim().toUpperCase();

    const outcome = await withTenantTransaction(ctx.organizationId, async (client) => {
      // Verify staff exists
      const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
      if (!staffCheck.rows[0]) {
        return { error: { status: 404, message: 'Staff not found' } } as const;
      }

      // Find the item — must be TESTED (or already PACKED/LABEL_ASSIGNED for re-scan)
      const itemRes = await client.query(
        `SELECT * FROM fba_shipment_items
       WHERE shipment_id = $1 AND fnsku = $2 AND organization_id = $3`,
        [shipment_id, normalizedFnsku, ctx.organizationId]
      );

      if (!itemRes.rows[0]) {
        return { error: { status: 404, message: `FNSKU ${fnsku} not found in shipment ${shipment_id}` } } as const;
      }

      const item = itemRes.rows[0];
      if (item.status === 'PLANNED') {
        return { error: { status: 409, message: 'Item must be TESTED before the packer can pack it' } } as const;
      }
      if (item.status === 'SHIPPED') {
        return { error: { status: 409, message: 'Item is already shipped' } } as const;
      }

      // Advance TESTED → PACKED (idempotent — leaves already-packed/combined items as-is).
      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
       SET status               = CASE WHEN status = 'TESTED'
                                       THEN 'PACKED'::fba_shipment_status_enum
                                       ELSE status END,
           verified_by_staff_id = COALESCE(verified_by_staff_id, $1),
           verified_at          = COALESCE(verified_at, NOW()),
           updated_at           = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
        [staff_id, item.id, ctx.organizationId]
      );

      const logRes = await client.query(
        `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata, organization_id)
       VALUES ($1, 'PACK', 'VERIFIED', $2, $3, $4, 0, $5, $6, $7::jsonb, $8)
       RETURNING id, created_at`,
        [
          normalizedFnsku,
          staff_id,
          shipment_id,
          item.id,
          station || 'PACK_VERIFY',
          'Packer verification',
          JSON.stringify({
            trigger: 'fba.items.verify',
            item_status: item.status,
          }),
          ctx.organizationId,
        ]
      );

      return {
        item,
        updatedItem: updatedRes.rows[0],
        event: {
          id: Number(logRes.rows[0].id),
          created_at: logRes.rows[0].created_at,
          type: 'FBA_LOG' as const,
        },
        staff_name: staffCheck.rows[0].name,
      };
    });

    if ('error' in outcome && outcome.error) {
      return NextResponse.json(
        { success: false, error: outcome.error.message },
        { status: outcome.error.status }
      );
    }

    await invalidateCacheTags(['fba-board']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    await publishFbaItemChanged({ action: 'verify', shipmentId: Number(shipment_id || 0), itemId: Number(outcome.item?.id || 0), fnsku: normalizedFnsku || '', source: 'fba.items.verify', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      item: outcome.updatedItem,
      event: outcome.event,
      staff_name: outcome.staff_name,
    });
  } catch (error: any) {
    console.error('[POST /api/fba/items/verify]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to verify item' },
      { status: 500 }
    );
  }
}, {
  permission: 'fba.stage_shipments',
  feature: 'fba',
  audit: {
    source: 'fba.items.verify',
    action: 'fba.fnsku.verify',
    entityType: 'fba_shipment_item',
    entityId: ({ body }) => {
      const b = body as { shipment_id?: number; fnsku?: string } | null;
      return b?.shipment_id ?? null;
    },
    extra: ({ body }) => {
      const b = body as { fnsku?: string } | null;
      return { fnsku: b?.fnsku ?? null };
    },
  },
});
