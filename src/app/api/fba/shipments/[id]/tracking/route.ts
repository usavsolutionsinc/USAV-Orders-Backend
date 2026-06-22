import { NextRequest, NextResponse } from 'next/server';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';
import { detectCarrier } from '@/lib/tracking-format';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { normalizeAllocations, replaceTrackingAllocations } from '@/lib/fba/replace-tracking-allocations';
import { requireRoutePerm, recordRouteAudit } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

type Params = Promise<{ id: string }>;

// ── GET /api/fba/shipments/[id]/tracking ─────────────────────────────────────
// Returns all tracking numbers linked to this shipment via fba_shipment_tracking.
export async function GET(
  req: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(req, 'fba.view');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const result = await tenantQuery(
      gate.ctx.organizationId,
      `SELECT
         fst.id          AS link_id,
         fst.label,
         fst.created_at  AS linked_at,
         stn.id          AS tracking_id,
         stn.tracking_number_raw,
         stn.tracking_number_normalized,
         stn.carrier,
         stn.latest_status_category,
         stn.latest_status_description,
         stn.is_label_created,
         stn.is_carrier_accepted,
         stn.is_in_transit,
         stn.is_out_for_delivery,
         stn.is_delivered,
         stn.has_exception,
         stn.is_terminal,
         stn.delivered_at,
         stn.latest_event_at,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'shipment_item_id', fta.shipment_item_id,
                 'qty', fta.qty,
                 'fnsku', fsi.fnsku,
                 'display_title', COALESCE(NULLIF(TRIM(fsi.product_title), ''), fsi.fnsku)
               )
               ORDER BY fta.shipment_item_id
             )
             FROM fba_tracking_item_allocations fta
             JOIN fba_shipment_items fsi ON fsi.id = fta.shipment_item_id
               AND fsi.organization_id = $2
             WHERE fta.shipment_id = fst.shipment_id
               AND fta.tracking_id = fst.tracking_id
               AND fta.organization_id = $2
           ),
           '[]'::jsonb
         ) AS allocations
       FROM fba_shipment_tracking fst
       JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
       WHERE fst.shipment_id = $1
         AND fst.organization_id = $2
       ORDER BY fst.created_at DESC`,
      [planId, gate.ctx.organizationId]
    );

    return NextResponse.json({ success: true, tracking: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch tracking' },
      { status: 500 }
    );
  }
}

// ── POST /api/fba/shipments/[id]/tracking ────────────────────────────────────
// Links a tracking number to this shipment.
// 1. Upserts the raw tracking number into shipping_tracking_numbers.
// 2. Creates the link in fba_shipment_tracking.
// 3. Optional: replaces per-item bundle allocations for this shipment+tracking.
// Body: {
//   tracking_number: string,
//   carrier?: string,
//   label?: string,
//   staff_id?: number,
//   station?: string,
//   allocations?: [{ shipment_item_id|item_id, quantity|qty }]
// }
export async function POST(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const body = await request.json();
    const raw = String(body.tracking_number || '').trim().toUpperCase();
    if (!raw) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const carrier = String(body.carrier || detectCarrier(raw)).toUpperCase();
    const label = body.label ? String(body.label).trim() : null;
    const staffId = Number.isFinite(Number(body?.staff_id)) ? Number(body.staff_id) : null;
    const station = body?.station ? String(body.station).trim() : null;
    const hasAllocationsPayload = Object.prototype.hasOwnProperty.call(body ?? {}, 'allocations');
    const allocations = hasAllocationsPayload ? normalizeAllocations(body.allocations) : [];

    const { trackingId, linkRes, allocationCount } = await withTenantTransaction(orgId, async (client) => {
      // Upsert into shipping_tracking_numbers
      const trackRes = await client.query(
        // shipping_tracking_numbers.organization_id is a stamped-but-global
        // natural key (SoT: lib/shipping/repository.ts upsertShipment). Stamp it
        // on INSERT and HEAL it on conflict (COALESCE keeps a non-null existing
        // value, fills a NULL one) so a row first created by a session-less
        // writer gets attributed. The GUC default would also stamp inside this
        // txn, but the explicit form matches the SoT and heals NULL rows.
        `INSERT INTO shipping_tracking_numbers
           (tracking_number_raw, tracking_number_normalized, carrier, source_system, organization_id)
         VALUES ($1, $2, $3, 'fba', $4::uuid)
         ON CONFLICT (tracking_number_normalized) DO UPDATE
           SET source_system = COALESCE(shipping_tracking_numbers.source_system, EXCLUDED.source_system),
               organization_id = COALESCE(shipping_tracking_numbers.organization_id, EXCLUDED.organization_id),
               updated_at    = NOW()
         RETURNING id, tracking_number_raw, carrier`,
        [raw, raw, carrier, orgId]
      );
      const trackingId = trackRes.rows[0].id;

      // Link to the shipment
      const linkRes = await client.query(
        `INSERT INTO fba_shipment_tracking (shipment_id, tracking_id, label, organization_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (shipment_id, tracking_id) DO UPDATE
           SET label = COALESCE(EXCLUDED.label, fba_shipment_tracking.label),
               created_at = fba_shipment_tracking.created_at
         RETURNING id, label, created_at`,
        [planId, trackingId, label, orgId]
      );

      let allocationCount = 0;
      if (hasAllocationsPayload) {
        allocationCount = await replaceTrackingAllocations(client, {
          orgId,
          shipmentId: planId,
          trackingId: Number(trackingId),
          allocations,
          staffId,
          station,
        });
      }

      return { trackingId, linkRes, allocationCount };
    });

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'tracking-linked', shipmentId: Number(id), source: 'fba.shipments.tracking.link', organizationId: gate.ctx.organizationId });

    return NextResponse.json(
      {
        success: true,
        link_id: linkRes.rows[0].id,
        tracking_id: trackingId,
        tracking_number: raw,
        carrier,
        label: linkRes.rows[0].label,
        allocation_count: allocationCount,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[POST /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to link tracking number' },
      { status: 500 }
    );
  }
}

// ── PATCH /api/fba/shipments/[id]/tracking ───────────────────────────────────
// Updates a linked tracking row by link id.
// Body: {
//   link_id: number,
//   tracking_number: string,
//   carrier?: string,
//   label?: string,
//   staff_id?: number,
//   station?: string,
//   allocations?: [{ shipment_item_id|item_id, quantity|qty }]
// }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const body = await request.json();
    const linkId = Number(body?.link_id);
    const raw = String(body?.tracking_number || '').trim().toUpperCase();
    const label = body?.label != null ? String(body.label || '').trim() || null : undefined;
    const staffId = Number.isFinite(Number(body?.staff_id)) ? Number(body.staff_id) : null;
    const station = body?.station ? String(body.station).trim() : null;
    const hasAllocationsPayload = Object.prototype.hasOwnProperty.call(body ?? {}, 'allocations');
    const allocations = hasAllocationsPayload ? normalizeAllocations(body.allocations) : [];
    if (!Number.isFinite(linkId) || linkId <= 0) {
      return NextResponse.json({ success: false, error: 'link_id is required' }, { status: 400 });
    }
    if (!raw) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const carrier = String(body?.carrier || detectCarrier(raw)).toUpperCase();

    const outcome = await withTenantTransaction(orgId, async (client) => {
      const linkCheck = await client.query(
        `SELECT id, tracking_id
         FROM fba_shipment_tracking
         WHERE id = $1 AND shipment_id = $2 AND organization_id = $3`,
        [linkId, planId, orgId]
      );
      if (!linkCheck.rows[0]) {
        return { error: 'Tracking link not found', status: 404 as const };
      }

      const trackRes = await client.query(
        // Stamp + heal organization_id (SoT: lib/shipping/repository.ts) — see POST note.
        `INSERT INTO shipping_tracking_numbers
           (tracking_number_raw, tracking_number_normalized, carrier, source_system, organization_id)
         VALUES ($1, $2, $3, 'fba', $4::uuid)
         ON CONFLICT (tracking_number_normalized) DO UPDATE
           SET tracking_number_raw = EXCLUDED.tracking_number_raw,
               carrier = COALESCE(NULLIF(EXCLUDED.carrier, 'UNKNOWN'), shipping_tracking_numbers.carrier),
               organization_id = COALESCE(shipping_tracking_numbers.organization_id, EXCLUDED.organization_id),
               updated_at = NOW()
         RETURNING id, tracking_number_raw, carrier`,
        [raw, raw, carrier, orgId]
      );

      const trackingId = Number(trackRes.rows[0].id);
      const previousTrackingId = Number(linkCheck.rows[0].tracking_id);
      const nextCarrier = String(trackRes.rows[0].carrier || carrier || 'UNKNOWN').toUpperCase();

      const updates: string[] = ['tracking_id = $1'];
      const values: unknown[] = [trackingId];
      let idx = 2;
      if (label !== undefined) {
        updates.push(`label = $${idx++}`);
        values.push(label);
      }
      values.push(linkId, planId, orgId);

      const updated = await client.query(
        `UPDATE fba_shipment_tracking
         SET ${updates.join(', ')}
         WHERE id = $${idx} AND shipment_id = $${idx + 1} AND organization_id = $${idx + 2}
         RETURNING id, shipment_id, tracking_id, label, created_at`,
        values
      );

      if (previousTrackingId !== trackingId) {
        await client.query(
          `INSERT INTO fba_tracking_item_allocations
             (shipment_id, tracking_id, shipment_item_id, qty, created_at, updated_at, organization_id)
           SELECT shipment_id, $3, shipment_item_id, qty, created_at, NOW(), organization_id
           FROM fba_tracking_item_allocations
           WHERE shipment_id = $1 AND tracking_id = $2 AND organization_id = $4
           ON CONFLICT (shipment_id, tracking_id, shipment_item_id)
           DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
          [planId, previousTrackingId, trackingId, orgId]
        );
        await client.query(
          `DELETE FROM fba_tracking_item_allocations
           WHERE shipment_id = $1 AND tracking_id = $2 AND organization_id = $3`,
          [planId, previousTrackingId, orgId]
        );
      }

      let allocationCount = 0;
      if (hasAllocationsPayload) {
        allocationCount = await replaceTrackingAllocations(client, {
          orgId,
          shipmentId: planId,
          trackingId,
          allocations,
          staffId,
          station,
        });
      }

      return { updated, trackingId, nextCarrier, allocationCount };
    });

    if ('error' in outcome) {
      return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    }

    const { updated, nextCarrier, allocationCount } = outcome;

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'tracking-linked', shipmentId: Number(id), source: 'fba.shipments.tracking.update', organizationId: gate.ctx.organizationId });

    return NextResponse.json({
      success: true,
      link_id: Number(updated.rows[0].id),
      shipment_id: Number(updated.rows[0].shipment_id),
      tracking_id: Number(updated.rows[0].tracking_id),
      tracking_number: raw,
      carrier: nextCarrier,
      label: updated.rows[0].label ?? null,
      allocation_count: allocationCount,
    });
  } catch (error: any) {
    console.error('[PATCH /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update tracking number' },
      { status: 500 }
    );
  }
}

// ── DELETE /api/fba/shipments/[id]/tracking?link_id=X ────────────────────────
// Unlinks a tracking record from this shipment (does not delete the tracking record itself).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.stage_shipments');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    const { searchParams } = new URL(request.url);
    const linkId = Number(searchParams.get('link_id') || '');

    if (planId == null || !Number.isFinite(linkId)) {
      const error = planId == null ? getInvalidFbaPlanIdMessage(id) : 'Invalid ids';
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    await withTenantTransaction(orgId, async (client) => {
      const linkRes = await client.query(
        `DELETE FROM fba_shipment_tracking
         WHERE id = $1 AND shipment_id = $2 AND organization_id = $3
         RETURNING tracking_id`,
        [linkId, planId, orgId]
      );

      const trackingId = Number(linkRes.rows[0]?.tracking_id || 0);
      if (trackingId > 0) {
        await client.query(
          `DELETE FROM fba_tracking_item_allocations
           WHERE shipment_id = $1 AND tracking_id = $2 AND organization_id = $3`,
          [planId, trackingId, orgId]
        );
      }
    });

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'tracking-unlinked', shipmentId: Number(id), source: 'fba.shipments.tracking.unlink', organizationId: gate.ctx.organizationId });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/fba/shipments/[id]/tracking]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to unlink tracking' },
      { status: 500 }
    );
  }
}
