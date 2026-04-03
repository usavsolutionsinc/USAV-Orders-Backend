import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createStationActivityLog } from '@/lib/station-activity';
import { publishFbaItemChanged, publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';
import { upsertFnskuCatalogRow } from '@/lib/fba/upsert-fnsku-catalog';

// Pack-station FNSKU scan.
// Writes into the shared fba_fnsku_logs ledger and, when an open shipment item
// exists, increments the shipment item's actual_qty and advances it to READY_TO_GO.
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { fnsku, staff_id, station } = body;

    if (!fnsku?.trim() || !staff_id) {
      return NextResponse.json({ success: false, error: 'fnsku and staff_id are required' }, { status: 400 });
    }

    const normalizedFnsku = String(fnsku).trim().toUpperCase();

    await client.query('BEGIN');

    const staffCheck = await client.query('SELECT id, name FROM staff WHERE id = $1', [staff_id]);
    if (!staffCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    // Ensure FNSKU exists in catalog. When the scan is a B0 ASIN and the
    // catalog already maps that ASIN to a real X00 FNSKU, the resolved fnsku
    // will be the real FNSKU.
    const isAsinScan = /^B0[A-Z0-9]{8}$/i.test(normalizedFnsku);
    const meta = await upsertFnskuCatalogRow(client, {
      fnsku: normalizedFnsku,
      asin: isAsinScan ? normalizedFnsku : null,
    });
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
       ORDER BY
         CASE fsi.status
           WHEN 'PACKING' THEN 1
           WHEN 'PLANNED' THEN 2
           WHEN 'READY_TO_GO' THEN 3
           WHEN 'LABEL_ASSIGNED' THEN 4
           ELSE 4
         END,
         fs.created_at ASC,
         fsi.id ASC
       LIMIT 1`,
      [resolvedFnsku]
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
                        WHEN status IN ('PLANNED', 'PACKING') THEN 'READY_TO_GO'::fba_shipment_status_enum
                        ELSE status
                      END,
             verified_by_staff_id = COALESCE(verified_by_staff_id, $1),
             verified_at = COALESCE(verified_at, NOW()),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [staff_id, openItem.id]
      );
      updatedItem = updatedRes.rows[0];
    } else {
      // ── No plan item exists: auto-add to today's plan ───────────────
      // Find or create today's PLANNED shipment.
      let todayPlanRes = await client.query(
        `SELECT id, shipment_ref FROM fba_shipments
         WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
         ORDER BY created_at DESC LIMIT 1`,
      );

      let todayPlanId: number;
      if (todayPlanRes.rows.length === 0) {
        const dateRes = await client.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
        const ref = buildFbaPlanRefFromIsoDate(String(dateRes.rows[0]?.d || ''));
        const newPlan = await client.query(
          `INSERT INTO fba_shipments (shipment_ref, due_date, status)
           VALUES ($1, CURRENT_DATE, 'PLANNED') RETURNING id`,
          [ref],
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
            verified_by_staff_id, verified_at)
         VALUES ($1, $2, $3, $4, $5, 1, 1, 'READY_TO_GO', $6, NOW())
         RETURNING *`,
        [todayPlanId, resolvedFnsku, meta.product_title, meta.asin, meta.sku, staff_id],
      );
      updatedItem = newItemRes.rows[0];
      // Treat it as a found open item for the rest of the flow.
      openItem = { ...updatedItem, shipment_ref: todayPlanRes.rows[0]?.shipment_ref ?? null };
    }

    // ── Refresh shipment aggregate counts ──────────────────────────────
    if (updatedItem?.shipment_id) {
      await client.query(
        `UPDATE fba_shipments fs
         SET ready_item_count = counts.ready_item_count,
             packed_item_count = counts.packed_item_count,
             shipped_item_count = counts.shipped_item_count,
             status = CASE
                        WHEN fs.status = 'PLANNED' AND counts.planned_item_count = 0 THEN 'READY_TO_GO'::fba_shipment_status_enum
                        ELSE fs.status
                      END,
             updated_at = NOW()
         FROM (
           SELECT
             shipment_id,
             COUNT(*) FILTER (WHERE status IN ('READY_TO_GO', 'LABEL_ASSIGNED', 'SHIPPED'))::int AS ready_item_count,
             COUNT(*) FILTER (WHERE status IN ('LABEL_ASSIGNED', 'SHIPPED'))::int AS packed_item_count,
             COUNT(*) FILTER (WHERE status = 'SHIPPED')::int AS shipped_item_count,
             COUNT(*) FILTER (WHERE status = 'PLANNED')::int AS planned_item_count
           FROM fba_shipment_items
           WHERE shipment_id = $1
           GROUP BY shipment_id
         ) counts
         WHERE fs.id = counts.shipment_id`,
        [updatedItem.shipment_id],
      );
    }

    const fnskuLogRes = await client.query(
      `INSERT INTO fba_fnsku_logs
         (fnsku, source_stage, event_type, staff_id, fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata)
       VALUES ($1, 'PACK', 'READY', $2, $3, $4, 1, $5, $6, $7::jsonb)
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
      ]
    );

    await createStationActivityLog(client, {
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
         AND event_type != 'VOID'`,
      [resolvedFnsku]
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
           AND event_type != 'VOID'`,
        [updatedItem.id]
      );
      combinedPackScannedQty = Number(itemPackRes.rows[0]?.q ?? 0);
    }

    const plannedQty = Number(updatedItem?.expected_qty ?? 0);

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    publishFbaItemChanged({
      action: 'scan',
      shipmentId: Number(updatedItem?.shipment_id || 0),
      itemId: Number(updatedItem?.id || 0),
      fnsku: resolvedFnsku,
      source: 'fba.items.scan',
    }).catch(() => {});
    if (autoCreatedPlan && updatedItem?.shipment_id) {
      publishFbaShipmentChanged({
        action: 'created',
        shipmentId: updatedItem.shipment_id,
        source: 'fba.items.scan.auto-plan',
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      fnsku: resolvedFnsku,
      scanned_raw: normalizedFnsku !== resolvedFnsku ? normalizedFnsku : undefined,
      fnsku_log_id: Number(fnskuLogRes.rows[0].id),
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
      status: updatedItem?.status || 'READY_TO_GO',
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
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/items/scan]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Scan failed' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
