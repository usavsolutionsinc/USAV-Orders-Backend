import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { withAuth } from '@/lib/auth/withAuth';

// ── POST /api/fba/labels/bind ─────────────────────────────────────────────────
// Combiner scans a shipping label barcode, then binds one or more FNSKUs to it.
// Transitions bound items from PACKED → LABEL_ASSIGNED (combined under one FBA
// shipment ID) and records immutable events in fba_fnsku_logs. All operations
// run in one transaction.
//
// Body: { shipment_id, label_barcode, fnskus: string[], station? } — actor from session.
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const { shipment_id, label_barcode, fnskus = [], station } = body;
    const staff_id = ctx.staffId;

    if (!shipment_id || !label_barcode?.trim()) {
      return NextResponse.json(
        { success: false, error: 'shipment_id and label_barcode are required' },
        { status: 400 }
      );
    }
    if (!Array.isArray(fnskus) || fnskus.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one fnsku is required' }, { status: 400 });
    }
    const normalizedFnskus = Array.from(
      new Set(
        fnskus
          .map((value: unknown) => String(value || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (normalizedFnskus.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one valid fnsku is required' }, { status: 400 });
    }

    const outcome = await withTenantTransaction(ctx.organizationId, async (client) => {
    // Verify staff
    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      return { error: { status: 404, message: 'Staff not found' } } as const;
    }

    // Verify shipment
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

    const boundItems: Array<Record<string, unknown>> = [];
    const errors: string[] = [];

    for (const fnsku of normalizedFnskus) {
      // Find the item — must be PACKED (or already LABEL_ASSIGNED for re-bind)
      const itemRes = await client.query(
        `SELECT * FROM fba_shipment_items WHERE shipment_id = $1 AND fnsku = $2 AND organization_id = $3`,
        [shipment_id, fnsku, ctx.organizationId]
      );

      if (!itemRes.rows[0]) {
        errors.push(`FNSKU ${fnsku} not found in shipment`);
        continue;
      }

      const item = itemRes.rows[0];
      if (item.status === 'PLANNED') {
        errors.push(`FNSKU ${fnsku} is not yet ready (still PLANNED)`);
        continue;
      }
      if (item.status === 'TESTED') {
        errors.push(`FNSKU ${fnsku} is not yet packed (still TESTED)`);
        continue;
      }
      if (item.status === 'SHIPPED') {
        errors.push(`FNSKU ${fnsku} is already shipped`);
        continue;
      }

      // Advance status to LABEL_ASSIGNED
      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
         SET status            = 'LABEL_ASSIGNED',
             labeled_by_staff_id = COALESCE(labeled_by_staff_id, $1),
             labeled_at        = COALESCE(labeled_at, NOW()),
             updated_at        = NOW()
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [staff_id, item.id, ctx.organizationId]
      );

      const logRes = await client.query(
        `INSERT INTO fba_fnsku_logs
           (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata, organization_id)
         VALUES ($1, 'PACK', 'ASSIGNED', $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING id, created_at`,
        [
          fnsku,
          staff_id,
          shipment_id,
          item.id,
          Math.max(1, Number(item.actual_qty) || 0),
          station || 'LABEL_BIND',
          'Label barcode bound to shipment item',
          JSON.stringify({
            label_barcode: String(label_barcode).trim(),
            trigger: 'fba.labels.bind',
            previous_status: item.status,
          }),
          ctx.organizationId,
        ]
      );

      boundItems.push({
        ...updatedRes.rows[0],
        log_id: Number(logRes.rows[0].id),
      });
    }

    // Auto-advance shipment status based on remaining item statuses.
    await client.query(
      `UPDATE fba_shipments
       SET status = CASE
                      WHEN NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2)
                        AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'TESTED' AND organization_id = $2)
                        AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PACKED' AND organization_id = $2)
                        THEN 'LABEL_ASSIGNED'::fba_shipment_status_enum
                      WHEN NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2)
                        AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'TESTED' AND organization_id = $2)
                        THEN 'PACKED'::fba_shipment_status_enum
                      WHEN NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2)
                        THEN 'TESTED'::fba_shipment_status_enum
                      ELSE status
                    END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [shipment_id, ctx.organizationId]
    );

    return { boundItems, errors };
    });

    if ('error' in outcome && outcome.error) {
      return NextResponse.json(
        { success: false, error: outcome.error.message },
        { status: outcome.error.status }
      );
    }

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    await publishFbaItemChanged({ action: 'label-bind', shipmentId: Number(shipment_id || 0), source: 'fba.labels.bind', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      label_barcode: String(label_barcode).trim(),
      shipment_id: Number(shipment_id),
      bound_items: outcome.boundItems,
      bound_count: outcome.boundItems.length,
      errors: outcome.errors.length > 0 ? outcome.errors : undefined,
    });
  } catch (error: any) {
    console.error('[POST /api/fba/labels/bind]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to bind label' },
      { status: 500 }
    );
  }
}, {
  permission: 'fba.stage_shipments',
  feature: 'fba',
  audit: {
    source: 'fba.labels.bind',
    action: 'fba.label.bind',
    entityType: 'fba_shipment',
    entityId: ({ body }) => {
      const b = body as { shipment_id?: number } | null;
      return b?.shipment_id ?? null;
    },
    extra: ({ body }) => {
      const b = body as { label_barcode?: string; fnskus?: string[] } | null;
      return {
        label_barcode: b?.label_barcode ?? null,
        fnsku_count: Array.isArray(b?.fnskus) ? b?.fnskus.length : 0,
      };
    },
  },
});
