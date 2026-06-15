import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { createStationActivityLog } from '@/lib/station-activity';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';

// ── POST /api/fba/items/ready ─────────────────────────────────────────────────
// Tech marks an FNSKU item as TESTED after testing/validation.
// Increments actual_qty and transitions status PLANNED → TESTED.
// Writes to fba_fnsku_logs in the same transaction.
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

      // Verify shipment exists and is not already SHIPPED
      const shipmentCheck = await client.query(
        `SELECT id, status FROM fba_shipments WHERE id = $1 AND organization_id = $2`,
        [shipment_id, ctx.organizationId]
      );
      if (!shipmentCheck.rows[0]) {
        return { error: { status: 404, message: 'Shipment not found' } } as const;
      }
      if (shipmentCheck.rows[0].status === 'SHIPPED') {
        return { error: { status: 409, message: 'Shipment is already closed' } } as const;
      }

      // Upsert the item (create if first scan, update if already exists)
      // Increment actual_qty and promote to TESTED
      const itemRes = await client.query(
        `INSERT INTO fba_shipment_items (shipment_id, fnsku, status, actual_qty, ready_by_staff_id, ready_at, organization_id)
       VALUES ($1, $2, 'TESTED', 1, $3, NOW(), $4)
       ON CONFLICT (shipment_id, fnsku) DO UPDATE
         SET actual_qty         = fba_shipment_items.actual_qty + 1,
             status             = CASE
                                    WHEN fba_shipment_items.status = 'PLANNED' THEN 'TESTED'::fba_shipment_status_enum
                                    ELSE fba_shipment_items.status
                                  END,
             ready_by_staff_id  = COALESCE(fba_shipment_items.ready_by_staff_id, $3),
             ready_at           = COALESCE(fba_shipment_items.ready_at, NOW()),
             updated_at         = NOW()
       RETURNING *`,
      [shipment_id, normalizedFnsku, staff_id, ctx.organizationId]
    );

      const item = itemRes.rows[0];

      const logRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata, organization_id)
       VALUES ($1, 'PACK', 'READY', $2, $3, $4, 1, $5, $6, $7::jsonb, $8)
       RETURNING id, created_at`,
      [
        normalizedFnsku,
        staff_id,
        shipment_id,
        item.id,
        station || 'TECH_READY',
        'Ready marked via /api/fba/items/ready',
        JSON.stringify({
          trigger: 'fba.items.ready',
          previous_status: item.status,
        }),
        ctx.organizationId,
      ]
    );

      await createStationActivityLog(client, {
      organizationId: ctx.organizationId,
      station: 'PACK',
      activityType: 'FBA_READY',
      staffId: Number(staff_id),
      scanRef: normalizedFnsku,
      fnsku: normalizedFnsku,
      fbaShipmentId: Number(shipment_id),
      fbaShipmentItemId: Number(item.id),
      notes: 'Ready marked via API',
      metadata: {
        fnsku_log_id: Number(logRes.rows[0].id),
        quantity: 1,
      },
    });

      // Auto-advance shipment PLANNED→TESTED when no planned items remain.
      await client.query(
      `UPDATE fba_shipments
       SET status = CASE
                      WHEN status = 'PLANNED' AND NOT EXISTS (
                        SELECT 1 FROM fba_shipment_items
                        WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2
                      ) THEN 'TESTED'::fba_shipment_status_enum
                      ELSE status
                    END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [shipment_id, ctx.organizationId]
    );

      return {
        item,
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

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await publishFbaItemChanged({ action: 'ready', shipmentId: Number(shipment_id || 0), itemId: Number(outcome.item?.id || 0), fnsku: normalizedFnsku || '', source: 'fba.items.ready', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      item: outcome.item,
      event: outcome.event,
      staff_name: outcome.staff_name,
    });
  } catch (error: any) {
    console.error('[POST /api/fba/items/ready]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to mark item ready' },
      { status: 500 }
    );
  }
}, {
  permission: 'fba.stage_shipments',
  audit: {
    source: 'fba.items.ready',
    action: 'fba.item.ready',
    entityType: 'fba_shipment_item',
    entityId: ({ body }) => {
      const b = body as { shipment_id?: number } | null;
      return b?.shipment_id ?? null;
    },
    extra: ({ body }) => {
      const b = body as { fnsku?: string } | null;
      return { fnsku: b?.fnsku ?? null };
    },
  },
});
