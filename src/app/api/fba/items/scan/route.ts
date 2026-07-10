import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { createStationActivityLog } from '@/lib/station-activity';
import { publishFbaItemChanged, publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';
import { upsertFnskuCatalogRow } from '@/lib/fba/upsert-fnsku-catalog';
import { withAuth } from '@/lib/auth/withAuth';

// Pack-station FNSKU scan (the packer's scan).
// Writes into the shared fba_fnsku_logs ledger and, when an open shipment item
// exists, increments the shipment item's actual_qty and advances it to PACKED
// (ready to combine). Tech testing is a prior step (PLANNED → TESTED).
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const { fnsku, station } = body;
    const staff_id = ctx.staffId;

    if (!fnsku?.trim()) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const normalizedFnsku = String(fnsku).trim().toUpperCase();

    const outcome = await withTenantTransaction(ctx.organizationId, async (client) => {
    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      return { error: { status: 404, message: 'Staff not found' } } as const;
    }

    // Ensure FNSKU exists in catalog. When the scan is a B0 ASIN and the
    // catalog already maps that ASIN to a real X00 FNSKU, the resolved fnsku
    // will be the real FNSKU.
    const isAsinScan = /^B0[A-Z0-9]{8}$/i.test(normalizedFnsku);
    const meta = await upsertFnskuCatalogRow(client, {
      fnsku: normalizedFnsku,
      asin: isAsinScan ? normalizedFnsku : null,
    }, ctx.organizationId);
    const resolvedFnsku = String(meta?.fnsku || normalizedFnsku).trim().toUpperCase();

    const itemRes = await client.query(
      `SELECT
         fsi.*,
         fs.shipment_ref,
         fs.status AS shipment_status
       FROM fba_shipment_items fsi
       JOIN fba_shipments fs ON fs.id = fsi.shipment_id
       WHERE fsi.fnsku = $1
         AND fs.status != 'SHIPPED'
         AND fsi.status != 'SHIPPED'
         AND fsi.organization_id = $2
         AND fs.organization_id = $2
       ORDER BY
         CASE fsi.status
           WHEN 'PLANNED' THEN 1
           WHEN 'TESTED' THEN 2
           WHEN 'PACKED' THEN 3
           WHEN 'LABEL_ASSIGNED' THEN 4
           ELSE 4
         END,
         fs.created_at ASC,
         fsi.id ASC
       LIMIT 1`,
      [resolvedFnsku, ctx.organizationId]
    );

    let openItem = itemRes.rows[0] ?? null;
    let updatedItem = openItem;
    let autoCreatedPlan = false;

    if (openItem) {
      // ── Existing plan item: increment actual_qty and advance status ──
      const updatedRes = await client.query(
        `UPDATE fba_shipment_items
         SET actual_qty = actual_qty + 1,
             status = CASE
                        WHEN status IN ('PLANNED', 'TESTED') THEN 'PACKED'::fba_shipment_status_enum
                        ELSE status
                      END,
             verified_by_staff_id = COALESCE(verified_by_staff_id, $1),
             verified_at = COALESCE(verified_at, NOW()),
             updated_at = NOW()
         WHERE id = $2 AND organization_id = $3
         RETURNING *`,
        [staff_id, openItem.id, ctx.organizationId]
      );
      updatedItem = updatedRes.rows[0];
    } else {
      // ── No plan item exists: auto-add to today's plan ───────────────
      // Find or create today's PLANNED shipment.
      let todayPlanRes = await client.query(
        `SELECT id, shipment_ref FROM fba_shipments
         WHERE due_date = CURRENT_DATE AND status = 'PLANNED' AND organization_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [ctx.organizationId],
      );

      let todayPlanId: number;
      if (todayPlanRes.rows.length === 0) {
        const dateRes = await client.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
        const ref = buildFbaPlanRefFromIsoDate(String(dateRes.rows[0]?.d || ''));
        const newPlan = await client.query(
          `INSERT INTO fba_shipments (shipment_ref, due_date, status, organization_id)
           VALUES ($1, CURRENT_DATE, 'PLANNED', $2) RETURNING id`,
          [ref, ctx.organizationId],
        );
        todayPlanId = newPlan.rows[0].id;
        autoCreatedPlan = true;
      } else {
        todayPlanId = todayPlanRes.rows[0].id;
      }

      // Insert a new item row with expected_qty=1 and actual_qty=1 (already scanned once).
      const newItemRes = await client.query(
        `INSERT INTO fba_shipment_items
           (shipment_id, fnsku, product_title, asin, sku,
            expected_qty, actual_qty, status,
            verified_by_staff_id, verified_at, organization_id)
         VALUES ($1, $2, $3, $4, $5, 1, 1, 'PACKED', $6, NOW(), $7)
         RETURNING *`,
        [todayPlanId, resolvedFnsku, meta.product_title, meta.asin, meta.sku, staff_id, ctx.organizationId],
      );
      updatedItem = newItemRes.rows[0];
      // Treat it as a found open item for the rest of the flow.
      openItem = { ...updatedItem, shipment_ref: todayPlanRes.rows[0]?.shipment_ref ?? null };
    }

    // ── Auto-advance shipment as items pack. Forward-only: advances from
    //    PLANNED/TESTED → PACKED (or → TESTED) and never regresses a shipment
    //    that is already PACKED/LABEL_ASSIGNED/SHIPPED. ──
    if (updatedItem?.shipment_id) {
      await client.query(
        `UPDATE fba_shipments fs
         SET status = CASE
                        WHEN fs.status IN ('PLANNED', 'TESTED')
                          AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2)
                          AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'TESTED' AND organization_id = $2)
                          THEN 'PACKED'::fba_shipment_status_enum
                        WHEN fs.status = 'PLANNED'
                          AND NOT EXISTS (SELECT 1 FROM fba_shipment_items WHERE shipment_id = $1 AND status = 'PLANNED' AND organization_id = $2)
                          THEN 'TESTED'::fba_shipment_status_enum
                        ELSE fs.status
                      END,
             updated_at = NOW()
         WHERE fs.id = $1 AND fs.organization_id = $2`,
        [updatedItem.shipment_id, ctx.organizationId],
      );
    }

    const fnskuLogRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata, organization_id)
       VALUES ($1, 'PACK', 'READY', $2, $3, $4, 1, $5, $6, $7::jsonb, $8)
       RETURNING id, created_at`,
      [
        resolvedFnsku,
        staff_id,
        updatedItem?.shipment_id ?? null,
        updatedItem?.id ?? null,
        station || 'PACK_STATION',
        autoCreatedPlan
          ? 'Pack station scan — auto-created today plan + item'
          : 'Pack station FNSKU ready scan',
        JSON.stringify({
          product_title: meta.product_title ?? null,
          sku: meta.sku ?? null,
          asin: meta.asin ?? null,
          scanned_raw: normalizedFnsku,
          resolved_fnsku: resolvedFnsku,
          matched_open_item: Boolean(openItem),
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
      fnsku: resolvedFnsku,
      fbaShipmentId: updatedItem?.shipment_id ?? null,
      fbaShipmentItemId: updatedItem?.id ?? null,
      notes: autoCreatedPlan
        ? 'Pack station scan — auto-created today plan + item'
        : 'Pack station FNSKU ready scan',
      metadata: {
        fnsku_log_id: Number(fnskuLogRes.rows[0].id),
        product_title: meta.product_title ?? null,
        sku: meta.sku ?? null,
        quantity: 1,
      },
    });

    const summaryRes = await client.query(
      `SELECT
         COALESCE(SUM(quantity) FILTER (WHERE source_stage IN ('TECH', 'FBA') AND event_type = 'SCANNED'), 0)::int AS tech_scanned_qty,
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'PACK' AND event_type IN ('READY', 'VERIFIED', 'BOXED')), 0)::int AS pack_ready_qty,
         COALESCE(SUM(quantity) FILTER (WHERE source_stage = 'SHIP' AND event_type = 'SHIPPED'), 0)::int AS shipped_qty
       FROM fba_fnsku_logs
       WHERE fnsku = $1
         AND event_type != 'VOID'
         AND organization_id = $2`,
      [resolvedFnsku, ctx.organizationId]
    );

    const summary = summaryRes.rows[0] || {
      tech_scanned_qty: 0,
      pack_ready_qty: 0,
      shipped_qty: 0,
    };
    const techScannedQty = Number(summary.tech_scanned_qty || 0);
    const packReadyQty = Number(summary.pack_ready_qty || 0);
    const shippedQty = Number(summary.shipped_qty || 0);

    // All packers' pack-station scans for this shipment line (ledger), or FNSKU-wide when no line match.
    let combinedPackScannedQty = packReadyQty;
    if (updatedItem?.id != null) {
      const itemPackRes = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS q
         FROM fba_fnsku_logs
         WHERE fba_shipment_item_id = $1
           AND source_stage = 'PACK'
           AND event_type IN ('READY', 'VERIFIED', 'BOXED')
           AND event_type != 'VOID'
           AND organization_id = $2`,
        [updatedItem.id, ctx.organizationId]
      );
      combinedPackScannedQty = Number(itemPackRes.rows[0]?.q ?? 0);
    }

    const plannedQty = Number(updatedItem?.expected_qty ?? 0);

    return {
      resolvedFnsku,
      meta,
      openItem,
      updatedItem,
      autoCreatedPlan,
      fnskuLogId: Number(fnskuLogRes.rows[0].id),
      techScannedQty,
      packReadyQty,
      shippedQty,
      combinedPackScannedQty,
      plannedQty,
    };
    });

    if ('error' in outcome && outcome.error) {
      return NextResponse.json(
        { success: false, error: outcome.error.message },
        { status: outcome.error.status }
      );
    }

    const {
      resolvedFnsku,
      meta,
      openItem,
      updatedItem,
      autoCreatedPlan,
      fnskuLogId,
      techScannedQty,
      packReadyQty,
      shippedQty,
      combinedPackScannedQty,
      plannedQty,
    } = outcome;

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    publishFbaItemChanged({
      action: 'scan',
      shipmentId: Number(updatedItem?.shipment_id || 0),
      itemId: Number(updatedItem?.id || 0),
      fnsku: resolvedFnsku,
      source: 'fba.items.scan',
      organizationId: ctx.organizationId,
    }).catch(() => {});
    if (autoCreatedPlan && updatedItem?.shipment_id) {
      publishFbaShipmentChanged({
        action: 'created',
        shipmentId: updatedItem.shipment_id,
        source: 'fba.items.scan.auto-plan',
        organizationId: ctx.organizationId,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      fnsku: resolvedFnsku,
      scanned_raw: normalizedFnsku !== resolvedFnsku ? normalizedFnsku : undefined,
      fnsku_log_id: fnskuLogId,
      product_title: meta.product_title || null,
      asin: meta.asin || null,
      sku: meta.sku || null,
      shipment_ref: openItem?.shipment_ref || null,
      shipment_id: updatedItem?.shipment_id ?? null,
      item_id: updatedItem?.id ?? null,
      actual_qty: updatedItem?.actual_qty ?? 0,
      expected_qty: updatedItem?.expected_qty ?? 0,
      planned_qty: plannedQty,
      combined_pack_scanned_qty: combinedPackScannedQty,
      status: updatedItem?.status || 'PACKED',
      is_new: autoCreatedPlan,
      auto_added_to_plan: true,
      summary: {
        tech_scanned_qty: techScannedQty,
        pack_ready_qty: packReadyQty,
        shipped_qty: shippedQty,
        available_to_ship: Math.max(Math.min(techScannedQty, packReadyQty) - shippedQty, 0),
      },
    });
  } catch (error: any) {
    console.error('[POST /api/fba/items/scan]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Scan failed' },
      { status: 500 }
    );
  }
}, {
  permission: 'fba.stage_shipments',
  feature: 'fba',
  audit: {
    source: 'fba.items.scan',
    action: 'fba.fnsku.scan',
    entityType: 'fba_fnsku',
    entityId: ({ body }) => {
      const b = body as { fnsku?: string } | null;
      return b?.fnsku ?? null;
    },
  },
});
