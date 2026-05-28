import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { detectCarrier } from '@/lib/tracking-format';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/fba/shipments/mark-shipped
 *
 * Marks combined items (PACKED / LABEL_ASSIGNED) as SHIPPED, optionally links a
 * UPS tracking number, and optionally stamps the Amazon shipment ID.
 *
 * Two ways to target the items:
 *  - item_ids[]  — explicit (from the combine UI), requires tracking_number.
 *  - scan        — a packer scans EITHER a UPS tracking number OR the FBA
 *                  shipment ID; both resolve to the same shipment and ship all
 *                  of its packed/combined items (tracking already attached at
 *                  combine time, so tracking_number is optional here).
 *
 * Body:
 * {
 *   item_ids?:           number[],  // fba_shipment_items.id[]
 *   scan?:               string,    // UPS tracking number OR FBA shipment ID
 *   tracking_number?:    string,    // UPS / carrier tracking number to link
 *   amazon_shipment_id?: string,    // optional Amazon FBA shipment ID
 *   carrier?:            string,    // auto-detected from tracking if omitted
 * }
 *
 * After marking shipped:
 *  - If ALL items in a shipment are SHIPPED and actual_qty >= expected_qty,
 *    the shipment is DELETED (fully fulfilled).
 */
export const POST = withAuth(async (request: NextRequest) => {
  const client = await pool.connect();
  try {
    const body = await request.json();
    let itemIds: number[] = Array.isArray(body.item_ids)
      ? body.item_ids.map(Number).filter((n: number) => Number.isFinite(n))
      : [];
    const rawTracking = String(body.tracking_number || '').trim().toUpperCase();
    const amazonShipmentId = body.amazon_shipment_id ? String(body.amazon_shipment_id).trim() : null;
    // Scan-to-ship: a packer can scan EITHER a UPS tracking number OR the FBA
    // shipment ID — both resolve to the same shipment and ship the whole package.
    const scan = String(body.scan || body.code || '').trim().toUpperCase();

    if (itemIds.length === 0 && !scan) {
      return NextResponse.json(
        { success: false, error: 'Provide item_ids or a scan (UPS tracking number or FBA shipment ID)' },
        { status: 400 }
      );
    }

    const carrier = String(body.carrier || (rawTracking ? detectCarrier(rawTracking) : '') || '').toUpperCase();

    await client.query('BEGIN');

    // ── 0. Scan-to-ship: resolve the shipment from a scanned UPS tracking number
    //       or FBA shipment ID (treated identically), then target its
    //       packed/combined items. ──
    if (itemIds.length === 0 && scan) {
      let shipmentId: number | null = null;
      const byTracking = await client.query(
        `SELECT fst.shipment_id
           FROM fba_shipment_tracking fst
           JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
          WHERE stn.tracking_number_normalized = $1
          LIMIT 1`,
        [scan]
      );
      if (byTracking.rows[0]) {
        shipmentId = Number(byTracking.rows[0].shipment_id);
      } else {
        const byFbaId = await client.query(
          `SELECT id FROM fba_shipments
            WHERE UPPER(amazon_shipment_id) = $1 OR UPPER(shipment_ref) = $1
            ORDER BY created_at DESC LIMIT 1`,
          [scan]
        );
        if (byFbaId.rows[0]) shipmentId = Number(byFbaId.rows[0].id);
      }
      if (shipmentId == null) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, error: `No shipment found for "${scan}" (UPS tracking or FBA shipment ID)` },
          { status: 404 }
        );
      }
      const idsRes = await client.query(
        `SELECT id FROM fba_shipment_items
          WHERE shipment_id = $1 AND status IN ('PACKED', 'LABEL_ASSIGNED')`,
        [shipmentId]
      );
      itemIds = idsRes.rows.map((r) => Number(r.id));
      if (itemIds.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, error: `Nothing to ship for "${scan}" — items are not yet packed/combined` },
          { status: 409 }
        );
      }
    }

    // ── 1. Fetch items to know which shipments are affected ───────────────────
    const itemsRes = await client.query(
      `SELECT id, shipment_id, expected_qty, status
       FROM fba_shipment_items
       WHERE id = ANY($1::int[])`,
      [itemIds]
    );
    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'No matching items found' }, { status: 404 });
    }

    const shipmentIds = Array.from(new Set(itemsRes.rows.map((r) => r.shipment_id as number)));

    // ── 2. Mark each item as SHIPPED with actual_qty = expected_qty ───────────
    await client.query(
      `UPDATE fba_shipment_items
       SET status        = 'SHIPPED',
           actual_qty    = expected_qty,
           shipped_at    = NOW(),
           updated_at    = NOW()
       WHERE id = ANY($1::int[]) AND status IN ('PACKED', 'LABEL_ASSIGNED')`,
      [itemIds]
    );

    // ── 3-4. Upsert + link a tracking number when one was supplied. When the
    //         packer scanned the FBA shipment ID (or a tracking already linked
    //         at combine time), no new tracking is provided — skip this. ──
    let trackingId: number | null = null;
    if (rawTracking) {
      const trackRes = await client.query(
        `INSERT INTO shipping_tracking_numbers
           (tracking_number_raw, tracking_number_normalized, carrier, source_system)
         VALUES ($1, $2, $3, 'fba')
         ON CONFLICT (tracking_number_normalized) DO UPDATE
           SET source_system = COALESCE(shipping_tracking_numbers.source_system, EXCLUDED.source_system),
               updated_at    = NOW()
         RETURNING id, tracking_number_raw, carrier`,
        [rawTracking, rawTracking, carrier]
      );
      trackingId = trackRes.rows[0].id as number;

      for (const shipId of shipmentIds) {
        await client.query(
          `INSERT INTO fba_shipment_tracking (shipment_id, tracking_id, label)
           VALUES ($1, $2, $3)
           ON CONFLICT (shipment_id, tracking_id) DO NOTHING`,
          [shipId, trackingId, 'UPS']
        );
      }
    }

    // ── 5. Optionally stamp amazon_shipment_id ────────────────────────────────
    if (amazonShipmentId) {
      await client.query(
        `UPDATE fba_shipments
         SET amazon_shipment_id = $1,
             updated_at         = NOW()
         WHERE id = ANY($2::int[])`,
        [amazonShipmentId, shipmentIds]
      );
    }

    // ── 6. Touch updated_at on each affected shipment ──────────────────────────
    for (const shipId of shipmentIds) {
      await client.query(
        `UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`,
        [shipId]
      );
    }

    // ── 7. Auto-close shipments where all items are fully shipped ─────────────
    const deletedShipments: number[] = [];
    for (const shipId of shipmentIds) {
      const checkRes = await client.query(
        `SELECT
           COUNT(*)                                                   AS total,
           COUNT(*) FILTER (WHERE status = 'SHIPPED'
                              AND actual_qty >= expected_qty)         AS fully_shipped
         FROM fba_shipment_items
         WHERE shipment_id = $1`,
        [shipId]
      );
      const { total, fully_shipped } = checkRes.rows[0];
      if (Number(total) > 0 && Number(total) === Number(fully_shipped)) {
        await client.query(`DELETE FROM fba_shipments WHERE id = $1`, [shipId]);
        deletedShipments.push(shipId);
      }
    }

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-shipments', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'mark-shipped', shipmentId: 0, source: 'fba.shipments.mark-shipped' });

    return NextResponse.json(
      {
        success: true,
        marked_shipped: itemsRes.rows.length,
        tracking_number: rawTracking || null,
        tracking_id: trackingId,
        carrier,
        affected_shipments: shipmentIds,
        deleted_shipments: deletedShipments,
      },
      { status: 200 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/mark-shipped]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to mark items shipped' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}, {
  permission: 'shipping.mark_shipped',
  audit: {
    source: 'fba.shipments.mark-shipped',
    action: 'fba.shipment.mark_shipped',
    entityType: AUDIT_ENTITY.SHIPMENT,
    entityId: ({ body }) => {
      const b = body as { item_ids?: number[] } | null;
      return Array.isArray(b?.item_ids) && b.item_ids.length > 0 ? b.item_ids[0] : null;
    },
    extra: ({ body, response }) => {
      const b = body as { item_ids?: number[]; tracking_number?: string; carrier?: string } | null;
      const r = response as { affected_shipments?: number[]; deleted_shipments?: number[] } | null;
      return {
        item_count: Array.isArray(b?.item_ids) ? b.item_ids.length : 0,
        tracking_number: b?.tracking_number ?? null,
        carrier: b?.carrier ?? null,
        affected_shipments: r?.affected_shipments ?? [],
        deleted_shipments: r?.deleted_shipments ?? [],
      };
    },
  },
});

