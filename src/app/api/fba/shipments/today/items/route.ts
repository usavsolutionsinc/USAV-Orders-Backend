import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/fba/shipments/today/items
 *
 * Adds FNSKUs to today's plan. If no plan exists for today it is
 * auto-created with shipment_ref = "FBA-{YYYYMMDD}".
 * FNSKUs already in today's plan are SKIPPED (not duplicated).
 *
 * Body:
 * {
 *   items: Array<{
 *     fnsku:          string;
 *     expected_qty:   number;    // default 1
 *     product_title?: string;
 *     asin?:          string;
 *     sku?:           string;
 *   }>
 * }
 *
 * Response:
 * {
 *   success: true,
 *   shipment_id:  number,
 *   shipment_ref: string,
 *   added:        { fnsku, expected_qty }[],
 *   skipped:      { fnsku, reason }[],
 * }
 */
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const items: Array<{
      fnsku: string;
      expected_qty?: number;
      product_title?: string;
      asin?: string;
      sku?: string;
    }> = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'items[] is required' }, { status: 400 });
    }

    await client.query('BEGIN');

    // ── 1. Find or create today's PLANNED shipment ────────────────────────────
    let todayShip = await client.query(`
      SELECT id, shipment_ref FROM fba_shipments
      WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
      ORDER BY created_at DESC LIMIT 1
    `);

    let shipmentId: number;
    let shipmentRef: string;

    if (todayShip.rows.length === 0) {
      // Auto-ref: FBA-YYYYMMDD
      const today = new Date();
      const pad  = (n: number) => String(n).padStart(2, '0');
      shipmentRef = `FBA-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;

      const newShip = await client.query(`
        INSERT INTO fba_shipments (shipment_ref, due_date, status)
        VALUES ($1, CURRENT_DATE, 'PLANNED')
        RETURNING id, shipment_ref
      `, [shipmentRef]);

      shipmentId  = newShip.rows[0].id;
      shipmentRef = newShip.rows[0].shipment_ref;
    } else {
      shipmentId  = todayShip.rows[0].id;
      shipmentRef = todayShip.rows[0].shipment_ref;
    }

    // ── 2. Load existing FNSKUs in today's plan ───────────────────────────────
    const existingRes = await client.query(
      `SELECT fnsku FROM fba_shipment_items WHERE shipment_id = $1`,
      [shipmentId]
    );
    const existingFnskus = new Set<string>(existingRes.rows.map((r) => r.fnsku));

    // ── 3. Insert new items, skip duplicates ──────────────────────────────────
    const added:   { fnsku: string; expected_qty: number }[] = [];
    const skipped: { fnsku: string; reason: string }[]       = [];

    for (const item of items) {
      const fnsku = String(item.fnsku || '').trim().toUpperCase();
      if (!fnsku) continue;

      if (existingFnskus.has(fnsku)) {
        skipped.push({ fnsku, reason: 'Already in today\'s plan' });
        continue;
      }

      const qty   = Math.max(1, Number(item.expected_qty) || 1);
      const title = item.product_title ? String(item.product_title).trim() : null;
      const asin  = item.asin          ? String(item.asin).trim()          : null;
      const sku   = item.sku           ? String(item.sku).trim()           : null;

      // Try to pull missing metadata from fba_fnskus catalog
      let catalogTitle = title;
      let catalogAsin  = asin;
      let catalogSku   = sku;
      if (!catalogTitle || !catalogAsin) {
        const cat = await client.query(
          `SELECT product_title, asin FROM fba_fnskus WHERE fnsku = $1 LIMIT 1`,
          [fnsku]
        );
        if (cat.rows.length > 0) {
          catalogTitle = catalogTitle || cat.rows[0].product_title || null;
          catalogAsin  = catalogAsin  || cat.rows[0].asin          || null;
        }
      }

      const itemRes = await client.query(
        `INSERT INTO fba_shipment_items
           (shipment_id, fnsku, expected_qty, product_title, asin, sku, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PLANNED')
         RETURNING id`,
        [shipmentId, fnsku, qty, catalogTitle, catalogAsin, catalogSku]
      );
      const itemId: number = itemRes.rows[0].id;

      // Create a work assignment so deadline_at is tracked for today
      await client.query(
        `INSERT INTO work_assignments
           (entity_type, entity_id, work_type, status, priority, deadline_at)
         VALUES ('FBA_SHIPMENT', $1, 'PACK', 'OPEN', 1,
                 (CURRENT_DATE + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz)`,
        [itemId]
      );

      added.push({ fnsku, expected_qty: qty });
      existingFnskus.add(fnsku); // prevent duplication within same request
    }

    // ── 4. Update total item count on shipment ────────────────────────────────
    await client.query(
      `UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`,
      [shipmentId]
    );

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      shipment_id:  shipmentId,
      shipment_ref: shipmentRef,
      added,
      skipped,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/today/items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
