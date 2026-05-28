import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';
import { formatPSTTimestamp } from '@/utils/date';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { requireRoutePerm, recordRouteAudit } from '@/lib/auth/dynamic-route-guard';
import { AUDIT_ENTITY } from '@/lib/audit-logs';

type Params = Promise<{ id: string }>;

// ── GET /api/fba/shipments/[id] ───────────────────────────────────────────────
// Returns a single FBA shipment with staff names and item count aggregates.
export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.view');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         fs.id,
         fs.shipment_ref,
         fs.amazon_shipment_id,
         fs.destination_fc,
         fs.due_date,
         fs.status,
         fs.notes,
         fs.shipped_at,
         fs.created_at,
         fs.updated_at,
         creator.name   AS created_by_name,
         tech.name      AS assigned_tech_name,
         packer.name    AS assigned_packer_name,
         fs.created_by_staff_id,
         fs.assigned_tech_id,
         fs.assigned_packer_id,
         COUNT(DISTINCT fsi.id)                                               AS total_items,
         COUNT(DISTINCT fsi.id) FILTER (WHERE fsi.status = 'TESTED')    AS ready_items,
         COUNT(DISTINCT fsi.id) FILTER (WHERE fsi.status = 'LABEL_ASSIGNED') AS labeled_items,
         COUNT(DISTINCT fsi.id) FILTER (WHERE fsi.status = 'SHIPPED')        AS shipped_items,
         COALESCE(SUM(DISTINCT fsi.expected_qty), 0)                          AS total_expected_qty,
         COALESCE(SUM(DISTINCT fsi.actual_qty), 0)                            AS total_actual_qty,
         COALESCE(
           jsonb_agg(
             DISTINCT jsonb_build_object(
               'link_id',            fst.id,
               'tracking_id',        stn.id,
               'tracking_number',    stn.tracking_number_raw,
               'carrier',            stn.carrier,
               'status_category',    stn.latest_status_category,
               'status_description', stn.latest_status_description,
               'is_delivered',       stn.is_delivered,
               'is_in_transit',      stn.is_in_transit,
               'has_exception',      stn.has_exception,
               'latest_event_at',    stn.latest_event_at,
               'label',              fst.label
             )
           ) FILTER (WHERE stn.id IS NOT NULL),
           '[]'::jsonb
         ) AS tracking_numbers
       FROM fba_shipments fs
       LEFT JOIN staff creator ON creator.id = fs.created_by_staff_id
       LEFT JOIN staff tech    ON tech.id    = fs.assigned_tech_id
       LEFT JOIN staff packer  ON packer.id  = fs.assigned_packer_id
       LEFT JOIN fba_shipment_items fsi ON fsi.shipment_id = fs.id
       LEFT JOIN fba_shipment_tracking fst ON fst.shipment_id = fs.id
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
       WHERE fs.id = $1
       GROUP BY fs.id, creator.name, tech.name, packer.name`,
      [planId]
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, shipment: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch shipment' },
      { status: 500 }
    );
  }
}

// ── PATCH /api/fba/shipments/[id] ─────────────────────────────────────────────
// Update mutable shipment fields.
// Body (all optional): { shipment_ref, destination_fc, due_date, notes,
//                        amazon_shipment_id, assigned_tech_id, assigned_packer_id, status }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    // Snapshot the row before update for audit diff.
    const beforeRow = await pool.query(
      `SELECT id, shipment_ref, amazon_shipment_id, destination_fc, due_date,
              status, notes, assigned_tech_id, assigned_packer_id
       FROM fba_shipments WHERE id = $1 LIMIT 1`,
      [planId],
    );
    const before = beforeRow.rows[0] ?? null;

    const body = await request.json();

    const allowedStatuses = ['PLANNED', 'TESTED', 'PACKED', 'OUT_OF_STOCK', 'LABEL_ASSIGNED', 'SHIPPED'];
    if (body.status && !allowedStatuses.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${allowedStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Dynamically build SET clause for only provided fields
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const setField = (col: string, val: unknown) => {
      fields.push(`${col} = $${idx++}`);
      values.push(val);
    };

    if ('shipment_ref' in body) setField('shipment_ref', String(body.shipment_ref || '').trim() || null);
    if ('destination_fc' in body) setField('destination_fc', body.destination_fc || null);
    if ('due_date' in body) setField('due_date', body.due_date || null);
    if ('notes' in body) setField('notes', body.notes || null);
    if ('amazon_shipment_id' in body) {
      const v = body.amazon_shipment_id;
      setField(
        'amazon_shipment_id',
        v != null && String(v).trim() ? String(v).trim().toUpperCase() : null
      );
    }
    if ('assigned_tech_id' in body) setField('assigned_tech_id', body.assigned_tech_id || null);
    if ('assigned_packer_id' in body) setField('assigned_packer_id', body.assigned_packer_id || null);
    if ('status' in body) {
      setField('status', body.status);
      if (body.status === 'SHIPPED') setField('shipped_at', formatPSTTimestamp());
    }

    if (fields.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    fields.push(`updated_at = NOW()`);
    values.push(planId);

    const result = await pool.query(
      `UPDATE fba_shipments
       SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      values
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }

    await invalidateCacheTags(['fba-board', 'fba-shipments']);
    await publishFbaShipmentChanged({ action: 'updated', shipmentId: Number(id), source: 'fba.shipments.update' });

    const response = NextResponse.json({ success: true, shipment: result.rows[0] });
    await recordRouteAudit(request, gate.ctx, response, {
      source: 'fba.shipments.update',
      action: 'fba.shipment.update',
      entityType: AUDIT_ENTITY.SHIPMENT,
      entityId: () => planId,
      extra: () => ({ before, after: result.rows[0] }),
    });
    return response;
  } catch (error: any) {
    console.error('[PATCH /api/fba/shipments/[id]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update shipment' },
      { status: 500 }
    );
  }
}

// ── DELETE /api/fba/shipments/[id] ────────────────────────────────────────────
// Hard-delete a shipment. Only allowed when status = 'PLANNED'.
// CASCADE removes all fba_shipment_items for this shipment.
// Destructive — requires step-up auth and writes a rich audit row.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    // shipping.void_order is on STEP_UP_PERMISSIONS, so the gate also
    // verifies a fresh step-up grant in addition to permission.
    const gate = await requireRoutePerm(request, 'shipping.void_order');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    // Snapshot for audit before destructive op.
    const check = await pool.query(
      `SELECT id, shipment_ref, status, amazon_shipment_id, destination_fc, due_date, notes
       FROM fba_shipments WHERE id = $1`,
      [planId]
    );
    if (!check.rows[0]) {
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }
    if (check.rows[0].status !== 'PLANNED') {
      return NextResponse.json(
        { success: false, error: `Cannot delete a shipment with status '${check.rows[0].status}'. Only PLANNED shipments can be deleted.` },
        { status: 409 }
      );
    }
    const before = check.rows[0];

    // Count items for the audit extra payload.
    const itemCountRow = await pool.query(
      `SELECT COUNT(*)::int AS n FROM fba_shipment_items WHERE shipment_id = $1`,
      [planId],
    );
    const itemCount = Number(itemCountRow.rows[0]?.n ?? 0);

    await pool.query(`DELETE FROM fba_shipments WHERE id = $1`, [planId]);

    await invalidateCacheTags(['fba-board', 'fba-shipments', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'deleted', shipmentId: Number(id), source: 'fba.shipments.delete' });

    const response = NextResponse.json({ success: true, deleted_id: planId });
    await recordRouteAudit(request, gate.ctx, response, {
      source: 'fba.shipments.delete',
      action: 'fba.shipment.delete',
      entityType: AUDIT_ENTITY.SHIPMENT,
      entityId: () => planId,
      extra: () => ({ before, item_count: itemCount }),
    });
    return response;
  } catch (error: any) {
    console.error('[DELETE /api/fba/shipments/[id]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete shipment' },
      { status: 500 }
    );
  }
}
