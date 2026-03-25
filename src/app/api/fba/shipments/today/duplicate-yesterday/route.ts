import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';

/**
 * POST /api/fba/shipments/today/duplicate-yesterday
 *
 * Copies all PLANNED items from yesterday's shipment into today's plan.
 * Creates today's plan if it doesn't exist.
 * Skips FNSKUs already in today's plan.
 */
export async function POST() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Find yesterday's shipment ─────────────────────────────────────────
    const yesterdayRes = await client.query(`
      SELECT id, shipment_ref FROM fba_shipments
      WHERE due_date = CURRENT_DATE - INTERVAL '1 day'
        AND status = 'PLANNED'
      ORDER BY created_at DESC LIMIT 1
    `);

    if (yesterdayRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'No plan found for yesterday' }, { status: 404 });
    }

    const yesterdayId = yesterdayRes.rows[0].id;

    // ── 2. Get yesterday's items ──────────────────────────────────────────────
    const itemsRes = await client.query(
      `SELECT fnsku, expected_qty, product_title, asin, sku
       FROM fba_shipment_items WHERE shipment_id = $1`,
      [yesterdayId]
    );

    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Yesterday\'s plan has no items' }, { status: 404 });
    }

    // ── 3. Find or create today's shipment ───────────────────────────────────
    let todayRes = await client.query(`
      SELECT id, shipment_ref FROM fba_shipments
      WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
      ORDER BY created_at DESC LIMIT 1
    `);

    let todayId: number;
    let todayRef: string;

    if (todayRes.rows.length === 0) {
      const todayIso = await client.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
      const ref = buildFbaPlanRefFromIsoDate(String(todayIso.rows[0]?.d || ''));
      const newRes = await client.query(
        `INSERT INTO fba_shipments (shipment_ref, due_date, status)
         VALUES ($1, CURRENT_DATE, 'PLANNED') RETURNING id, shipment_ref`,
        [ref]
      );
      todayId = newRes.rows[0].id;
      todayRef = newRes.rows[0].shipment_ref;
    } else {
      todayId = todayRes.rows[0].id;
      todayRef = todayRes.rows[0].shipment_ref;
    }

    // ── 4. Load existing FNSKUs in today's plan ──────────────────────────────
    const existingRes = await client.query(
      `SELECT fnsku FROM fba_shipment_items WHERE shipment_id = $1`,
      [todayId]
    );
    const existingSet = new Set<string>(existingRes.rows.map((r: any) => r.fnsku));

    // ── 5. Insert new items ──────────────────────────────────────────────────
    const added: string[] = [];
    const skipped: string[] = [];

    for (const item of itemsRes.rows) {
      if (existingSet.has(item.fnsku)) { skipped.push(item.fnsku); continue; }
      const newItemRes = await client.query(
        `INSERT INTO fba_shipment_items (shipment_id, fnsku, expected_qty, product_title, asin, sku, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PLANNED') RETURNING id`,
        [todayId, item.fnsku, item.expected_qty, item.product_title, item.asin, item.sku]
      );
      const newItemId: number = newItemRes.rows[0].id;

      await client.query(
        `INSERT INTO work_assignments
           (entity_type, entity_id, work_type, status, priority, deadline_at)
         VALUES ('FBA_SHIPMENT', $1, 'PACK', 'OPEN', 1,
                 (CURRENT_DATE + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz)`,
        [newItemId]
      );

      added.push(item.fnsku);
      existingSet.add(item.fnsku);
    }

    await client.query(`UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`, [todayId]);
    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      shipment_id: todayId,
      shipment_ref: todayRef,
      plan_ref: todayRef,
      added: added.length,
      skipped: skipped.length,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/today/duplicate-yesterday]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed' }, { status: 500 });
  } finally {
    client.release();
  }
}
