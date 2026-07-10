import { NextRequest, NextResponse } from 'next/server';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { detectCarrier } from '@/lib/tracking-format';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';
import {
  normalizeAllocations,
  refreshShipmentAggregateCounts,
  replaceTrackingAllocations,
} from '@/lib/fba/replace-tracking-allocations';

type LinePayload = { shipment_item_id: number; quantity?: number };

/**
 * POST /api/fba/shipments/split-for-paired-review
 *
 * When combine review changes the FBA Shipment ID vs the active-shipment card’s prefilled ID,
 * create a **new** plan with the new Amazon ID, move only the selected lines off the source plan,
 * clear their tracking allocations on the source, then attach UPS on the new plan.
 *
 * Body: {
 *   source_shipment_id: number,
 *   new_amazon_shipment_id: string,
 *   tracking_number: string,
 *   carrier?: string,
 *   label?: string,
 *   staff_id?: number,
 *   station?: string,
 *   lines: [{ shipment_item_id, quantity? }]
 * }
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const sourceShipmentId = Number(body?.source_shipment_id);
    const newAmazonRaw = String(body?.new_amazon_shipment_id || '').trim().toUpperCase();
    const raw = String(body?.tracking_number || '').trim().toUpperCase();
    const carrier = String(body?.carrier || detectCarrier(raw)).toUpperCase();
    const label = body?.label != null ? String(body.label || '').trim() || null : 'UPS';
    const staffId = ctx.staffId;
    const station = body?.station ? String(body.station).trim() : null;
    const linesRaw = Array.isArray(body?.lines) ? body.lines : [];

    if (!Number.isFinite(sourceShipmentId) || sourceShipmentId <= 0) {
      return NextResponse.json({ success: false, error: 'source_shipment_id is required' }, { status: 400 });
    }
    if (!newAmazonRaw) {
      return NextResponse.json({ success: false, error: 'new_amazon_shipment_id is required' }, { status: 400 });
    }
    if (!raw) {
      return NextResponse.json({ success: false, error: 'tracking_number is required' }, { status: 400 });
    }

    const lines: LinePayload[] = [];
    const seen = new Set<number>();
    for (const row of linesRaw) {
      const r = row as { shipment_item_id?: unknown; quantity?: unknown; qty?: unknown };
      const sid = Number(r.shipment_item_id);
      if (!Number.isFinite(sid) || sid <= 0 || seen.has(sid)) continue;
      seen.add(sid);
      const q = Math.floor(Number(r.quantity ?? r.qty ?? 1));
      lines.push({ shipment_item_id: sid, quantity: Number.isFinite(q) && q > 0 ? q : 1 });
    }
    if (lines.length === 0) {
      return NextResponse.json({ success: false, error: 'lines must include at least one shipment_item_id' }, { status: 400 });
    }

    const allocations = normalizeAllocations(
      lines.map((l) => ({ shipment_item_id: l.shipment_item_id, quantity: l.quantity ?? 1 })),
    );

    type SplitResult =
      | { kind: 'source_not_found' }
      | { kind: 'already_shipped' }
      | { kind: 'lines_not_on_source' }
      | { kind: 'ok'; newShipmentId: number; linkId: number; newRef: string };

    const outcome = await withTenantTransaction<SplitResult>(ctx.organizationId, async (client) => {
      const srcRes = await client.query(
        `SELECT id, status FROM fba_shipments WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [sourceShipmentId, ctx.organizationId],
      );
      if (!srcRes.rows[0]) {
        return { kind: 'source_not_found' };
      }
      if (String(srcRes.rows[0].status) === 'SHIPPED') {
        return { kind: 'already_shipped' };
      }

      const itemIds = lines.map((l) => l.shipment_item_id);
      const itemCheck = await client.query(
        `SELECT id FROM fba_shipment_items WHERE shipment_id = $1 AND id = ANY($2::int[]) AND organization_id = $3`,
        [sourceShipmentId, itemIds, ctx.organizationId],
      );
      if (itemCheck.rows.length !== itemIds.length) {
        return { kind: 'lines_not_on_source' };
      }

      for (const l of lines) {
        const qty = Math.max(1, l.quantity ?? 1);
        await client.query(
          `UPDATE fba_shipment_items SET expected_qty = $1, updated_at = NOW() WHERE id = $2 AND shipment_id = $3 AND organization_id = $4`,
          [qty, l.shipment_item_id, sourceShipmentId, ctx.organizationId],
        );
      }

      await client.query(
        `DELETE FROM fba_tracking_item_allocations WHERE shipment_item_id = ANY($1::int[]) AND organization_id = $2`,
        [itemIds, ctx.organizationId],
      );

      await client.query(
        `UPDATE fba_shipment_items fsi
         SET status = 'PLANNED',
             labeled_at = NULL,
             labeled_by_staff_id = NULL,
             updated_at = NOW()
         WHERE fsi.shipment_id = $1
           AND fsi.id = ANY($2::int[])
           AND fsi.status = 'LABEL_ASSIGNED'
           AND fsi.organization_id = $3
           AND NOT EXISTS (
             SELECT 1 FROM fba_tracking_item_allocations ftia
             WHERE ftia.shipment_item_id = fsi.id
               AND ftia.organization_id = fsi.organization_id
           )`,
        [sourceShipmentId, itemIds, ctx.organizationId],
      );

      const newRef = `split-${sourceShipmentId}-${Date.now()}`;

      const insertRes = await client.query(
        `INSERT INTO fba_shipments (
           shipment_ref, destination_fc, due_date, notes,
           amazon_shipment_id,
           assigned_tech_id, assigned_packer_id, created_by_staff_id,
           status, organization_id
         )
         SELECT
           $1,
           destination_fc,
           due_date,
           notes,
           $2,
           assigned_tech_id,
           assigned_packer_id,
           created_by_staff_id,
           'PLANNED'::fba_shipment_status_enum,
           organization_id
         FROM fba_shipments WHERE id = $3 AND organization_id = $4
         RETURNING id`,
        [newRef, newAmazonRaw, sourceShipmentId, ctx.organizationId],
      );
      const newShipmentId = Number(insertRes.rows[0]?.id);
      if (!Number.isFinite(newShipmentId)) {
        throw new Error('Failed to create split shipment');
      }

      await client.query(
        `UPDATE fba_shipment_items SET shipment_id = $1, updated_at = NOW() WHERE id = ANY($2::int[]) AND shipment_id = $3 AND organization_id = $4`,
        [newShipmentId, itemIds, sourceShipmentId, ctx.organizationId],
      );

      await refreshShipmentAggregateCounts(client, sourceShipmentId);
      await refreshShipmentAggregateCounts(client, newShipmentId);

      const trackRes = await client.query(
        // Stamp + heal organization_id (SoT: lib/shipping/repository.ts upsertShipment).
        `INSERT INTO shipping_tracking_numbers
           (tracking_number_raw, tracking_number_normalized, carrier, source_system, organization_id)
         VALUES ($1, $2, $3, 'fba', $4::uuid)
         ON CONFLICT (tracking_number_normalized) DO UPDATE
           SET source_system = COALESCE(shipping_tracking_numbers.source_system, EXCLUDED.source_system),
               organization_id = COALESCE(shipping_tracking_numbers.organization_id, EXCLUDED.organization_id),
               updated_at    = NOW()
         RETURNING id, tracking_number_raw, carrier`,
        [raw, raw, carrier, ctx.organizationId],
      );
      const trackingId = Number(trackRes.rows[0].id);

      const linkRes = await client.query(
        `INSERT INTO fba_shipment_tracking (shipment_id, tracking_id, label, organization_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (shipment_id, tracking_id) DO UPDATE
           SET label = COALESCE(EXCLUDED.label, fba_shipment_tracking.label),
               created_at = fba_shipment_tracking.created_at
         RETURNING id, label, created_at`,
        [newShipmentId, trackingId, label, ctx.organizationId],
      );

      await replaceTrackingAllocations(client, {
        orgId: ctx.organizationId,
        shipmentId: newShipmentId,
        trackingId,
        allocations,
        staffId,
        station,
      });

      return { kind: 'ok', newShipmentId, linkId: Number(linkRes.rows[0].id), newRef };
    });

    if (outcome.kind === 'source_not_found') {
      return NextResponse.json({ success: false, error: 'Source shipment not found' }, { status: 404 });
    }
    if (outcome.kind === 'already_shipped') {
      return NextResponse.json({ success: false, error: 'Cannot split a shipped shipment' }, { status: 409 });
    }
    if (outcome.kind === 'lines_not_on_source') {
      return NextResponse.json(
        { success: false, error: 'One or more lines are not on the source shipment' },
        { status: 400 },
      );
    }

    await invalidateCacheTags(['fba-shipments', 'fba-board', 'fba-stage-counts']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    await publishFbaShipmentChanged({ action: 'updated', shipmentId: sourceShipmentId, source: 'fba.split-for-paired', organizationId: ctx.organizationId });
    await publishFbaShipmentChanged({ action: 'created', shipmentId: outcome.newShipmentId, source: 'fba.split-for-paired', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      source_shipment_id: sourceShipmentId,
      new_shipment_id: outcome.newShipmentId,
      shipment_ref: outcome.newRef,
      amazon_shipment_id: newAmazonRaw,
      link_id: outcome.linkId,
      tracking_number: raw,
    });
  } catch (error: any) {
    console.error('[POST /api/fba/shipments/split-for-paired-review]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to split shipment' },
      { status: 500 },
    );
  }
}, {
  permission: 'fba.stage_shipments',
  feature: 'fba',
  audit: {
    source: 'fba.shipments.split',
    action: 'fba.shipment.split',
    entityType: 'fba_shipment',
    entityId: ({ body }) => {
      const b = body as { source_shipment_id?: number } | null;
      return b?.source_shipment_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as { new_shipment?: { id?: number; shipment_ref?: string } } | null;
      return {
        new_shipment_id: r?.new_shipment?.id ?? null,
        new_shipment_ref: r?.new_shipment?.shipment_ref ?? null,
      };
    },
  },
});
