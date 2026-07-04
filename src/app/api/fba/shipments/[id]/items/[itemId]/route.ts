import { NextRequest, NextResponse } from 'next/server';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';
import { formatPSTTimestamp } from '@/utils/date';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { requireRoutePerm, recordRouteAudit } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

type Params = Promise<{ id: string; itemId: string }>;

const STATUS_ORDER: Record<string, number> = {
  PLANNED: 0,
  TESTED: 1,
  OUT_OF_STOCK: 1, // same level as TESTED — sideways transition
  PACKED: 2,
  LABEL_ASSIGNED: 3,
  SHIPPED: 4,
};

// â”€â”€ GET /api/fba/shipments/[id]/items/[itemId] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns a single shipment item with staff name joins.
export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.view');
    if (gate.denied) return gate.denied;
    const { id, itemId } = await params;
    const shipmentId = parseFbaPlanId(id);
    const itemIdNum = Number(itemId);
    if (shipmentId == null || !Number.isFinite(itemIdNum)) {
      const error = shipmentId == null ? getInvalidFbaPlanIdMessage(id) : 'Invalid id';
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    const result = await tenantQuery(
      gate.ctx.organizationId,
      `SELECT
         fsi.id,
         fsi.shipment_id,
         fsi.fnsku,
         fsi.product_title,
         fsi.asin,
         fsi.sku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fsi.ready_by_staff_id,
         fsi.verified_by_staff_id,
         fsi.labeled_by_staff_id,
         fsi.shipped_by_staff_id,
         fsi.ready_at,
         fsi.verified_at,
         fsi.labeled_at,
         fsi.shipped_at,
         fsi.created_at,
         fsi.updated_at,
         r.name  AS ready_by_name,
         v.name  AS verified_by_name,
         l.name  AS labeled_by_name,
         sh.name AS shipped_by_name
       FROM fba_shipment_items fsi
       LEFT JOIN staff r  ON r.id  = fsi.ready_by_staff_id
       LEFT JOIN staff v  ON v.id  = fsi.verified_by_staff_id
       LEFT JOIN staff l  ON l.id  = fsi.labeled_by_staff_id
       LEFT JOIN staff sh ON sh.id = fsi.shipped_by_staff_id
       WHERE fsi.id = $1 AND fsi.shipment_id = $2 AND fsi.organization_id = $3`,
      [itemIdNum, shipmentId, gate.ctx.organizationId]
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/items/[itemId]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch item' },
      { status: 500 }
    );
  }
}

// â”€â”€ PATCH /api/fba/shipments/[id]/items/[itemId] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Update mutable item fields.
// Body (all optional): { fnsku, expected_qty, status, product_title, asin, sku,
//                        notes, staff_id }
// Guards against backward status transitions.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id, itemId } = await params;
    const shipmentId = parseFbaPlanId(id);
    const itemIdNum = Number(itemId);
    if (shipmentId == null || !Number.isFinite(itemIdNum)) {
      const error = shipmentId == null ? getInvalidFbaPlanIdMessage(id) : 'Invalid id';
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    const body = await request.json();
    const allowedStatuses = Object.keys(STATUS_ORDER);

    if (body.status && !allowedStatuses.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${allowedStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const outcome = await withTenantTransaction(orgId, async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2 AND organization_id = $3`,
        [itemIdNum, shipmentId, orgId]
      );
      if (!existing.rows[0]) {
        return { error: 'Item not found', status: 404 as const };
      }

      const currentStatus = existing.rows[0].status as string;
      if (body.status) {
        // Block only SHIPPEDâ†’anything (irreversible) or LABEL_ASSIGNEDâ†’PLANNED
        const currentRank = STATUS_ORDER[currentStatus] ?? 0;
        if (currentStatus === 'SHIPPED') {
          return { error: 'Cannot change status of a shipped item', status: 409 as const };
        }
        if (currentStatus === 'LABEL_ASSIGNED' && STATUS_ORDER[body.status] < currentRank) {
          return {
            error: `Cannot move status backward from '${currentStatus}' to '${body.status}'`,
            status: 409 as const,
          };
        }
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const setField = (col: string, val: unknown) => {
        fields.push(`${col} = $${idx++}`);
        values.push(val);
      };

      if ('fnsku' in body) {
        const normalizedFnsku = String(body.fnsku || '').trim().toUpperCase();
        if (!normalizedFnsku) {
          return { error: 'fnsku cannot be empty', status: 400 as const };
        }
        const conflict = await client.query(
          `SELECT id
           FROM fba_shipment_items
           WHERE shipment_id = $1
             AND fnsku = $2
             AND id <> $3
             AND organization_id = $4
           LIMIT 1`,
          [shipmentId, normalizedFnsku, itemIdNum, orgId]
        );
        if (conflict.rows[0]) {
          return {
            error: `FNSKU ${normalizedFnsku} already exists in this shipment`,
            status: 409 as const,
          };
        }
        setField('fnsku', normalizedFnsku);
      }

      if ('expected_qty' in body) setField('expected_qty', Math.max(0, Number(body.expected_qty) || 0));
      if ('product_title' in body) setField('product_title', body.product_title || null);
      if ('asin' in body) setField('asin', body.asin || null);
      if ('sku' in body) setField('sku', body.sku || null);
      if ('notes' in body) setField('notes', body.notes != null ? String(body.notes).trim() || null : null);

      // staff_id can be set independently (bulk-assign)
      if ('staff_id' in body && !body.status) setField('ready_by_staff_id', body.staff_id || null);

      if (body.status) {
        setField('status', body.status);
        const staffId = body.staff_id || null;
        if (body.status === 'TESTED') {
          setField('ready_by_staff_id', staffId);
          setField('ready_at', formatPSTTimestamp());
        } else if (body.status === 'PACKED') {
          setField('verified_by_staff_id', staffId);
          setField('verified_at', formatPSTTimestamp());
        } else if (body.status === 'LABEL_ASSIGNED') {
          setField('labeled_by_staff_id', staffId);
          setField('labeled_at', formatPSTTimestamp());
        } else if (body.status === 'SHIPPED') {
          setField('shipped_by_staff_id', staffId);
          setField('shipped_at', formatPSTTimestamp());
        }
      }

      if (fields.length === 0) {
        return { error: 'No fields to update', status: 400 as const };
      }

      fields.push(`updated_at = NOW()`);
      values.push(itemIdNum, shipmentId, orgId);

      const result = await client.query(
        `UPDATE fba_shipment_items
         SET ${fields.join(', ')}
         WHERE id = $${idx} AND shipment_id = $${idx + 1} AND organization_id = $${idx + 2}
         RETURNING *`,
        values
      );

      // When manually marked TESTED/PACKED (status cycle) with actual_qty=0,
      // backfill actual_qty = expected_qty so it isn't shown as 0 scanned.
      const row = result.rows[0];
      if ((row?.status === 'TESTED' || row?.status === 'PACKED') && Number(row.actual_qty) === 0 && Number(row.expected_qty) > 0) {
        const fixRes = await client.query(
          `UPDATE fba_shipment_items SET actual_qty = expected_qty, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [row.id, orgId]
        );
        if (fixRes.rows[0]) result.rows[0] = fixRes.rows[0];
      }

      // Touch updated_at so real-time listeners pick up the change
      await client.query(
        `UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [shipmentId, orgId]
      );

      return { item: result.rows[0] };
    });

    if ('error' in outcome) {
      return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    }

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await invalidateCacheTags(gate.ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    await publishFbaItemChanged({ action: 'update', shipmentId: Number(id), itemId: Number(itemId), source: 'fba.shipments.items.update', organizationId: gate.ctx.organizationId });

    return NextResponse.json({ success: true, item: outcome.item });
  } catch (error: any) {
    console.error('[PATCH /api/fba/shipments/[id]/items/[itemId]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update item' },
      { status: 500 }
    );
  }
}

// â”€â”€ DELETE /api/fba/shipments/[id]/items/[itemId] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Remove a shipment item from a plan.
// Any unshipped item can be removed. Shipped items are blocked.
// Tracking allocations referencing this item are cleaned up automatically
// (FK cascade), and a VOID log is recorded for audit.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id, itemId } = await params;
    const shipmentId = parseFbaPlanId(id);
    const itemIdNum = Number(itemId);
    if (shipmentId == null || !Number.isFinite(itemIdNum)) {
      const error = shipmentId == null ? getInvalidFbaPlanIdMessage(id) : 'Invalid id';
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    const outcome = await withTenantTransaction(orgId, async (client) => {
      const check = await client.query(
        `SELECT id, fnsku, status, expected_qty, actual_qty FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2 AND organization_id = $3`,
        [itemIdNum, shipmentId, orgId],
      );
      if (!check.rows[0]) {
        return { error: 'Item not found', status: 404 as const };
      }

      const row = check.rows[0] as {
        fnsku: string;
        status: string;
        expected_qty: number;
        actual_qty: number;
      };

      // Only block removal of already-shipped items.
      if (row.status === 'SHIPPED') {
        return {
          error: 'Cannot remove a shipped item. Mark the shipment as unshipped first.',
          status: 409 as const,
        };
      }

      // Audit log first — fba_shipment_item_id is NULL because the row is about to be deleted.
      // (The FK is ON DELETE SET NULL, so referencing the item_id before delete would also work,
      //  but NULL is cleaner since the row won't exist after this transaction.)
      await client.query(
        `INSERT INTO fba_fnsku_logs
           (fnsku, source_stage, event_type, fba_shipment_id, quantity, metadata, organization_id)
         VALUES ($1, 'FBA', 'VOID', $2, $3, $4::jsonb, $5)`,
        [
          row.fnsku,
          shipmentId,
          Number(row.expected_qty) || 0,
          JSON.stringify({
            removed_item_id: itemIdNum,
            removed_status: row.status,
            actual_qty: row.actual_qty,
          }),
          orgId,
        ],
      );

      // Delete tracking allocations for this item (belt-and-suspenders; FK cascade also handles this).
      await client.query(
        `DELETE FROM fba_tracking_item_allocations WHERE shipment_item_id = $1 AND organization_id = $2`,
        [itemIdNum, orgId],
      );

      // Delete the item itself.
      await client.query(
        `DELETE FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2 AND organization_id = $3`,
        [itemIdNum, shipmentId, orgId],
      );

      return { fnsku: row.fnsku };
    });

    if ('error' in outcome) {
      return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    }

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await invalidateCacheTags(gate.ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    publishFbaItemChanged({
      action: 'delete',
      shipmentId,
      itemId: itemIdNum,
      fnsku: outcome.fnsku,
      source: 'fba.shipments.items.delete',
      organizationId: gate.ctx.organizationId,
    }).catch(() => {});

    return NextResponse.json({ success: true, deleted_id: itemIdNum });
  } catch (error: any) {
    console.error('[DELETE /api/fba/shipments/[id]/items/[itemId]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete item' },
      { status: 500 },
    );
  }
}
