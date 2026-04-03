import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';
import { upsertFnskuCatalogRow } from '@/lib/fba/upsert-fnsku-catalog';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

/**
 * POST /api/fba/shipments/today/items
 *
 * Adds FNSKUs to today's plan. If no plan exists for today it is
 * auto-created with `shipment_ref` = plan code {@link buildFbaPlanRefFromIsoDate}.
 *
 * - FNSKUs already on today's plan: **set** `expected_qty` to the request value (replace, not add);
 *   any **other** PLANNED lines for the same FNSKU on non-today shipments are deleted first.
 * - FNSKU only on other pending (PLANNED) plans: rows are **moved** to today with `expected_qty`
 *   set from the request (other duplicate lines removed; not summed with previous qty).
 *
 * Body: { items: [{ fnsku, expected_qty?, product_title?, asin?, sku? }] }
 *
 * Response: { added, merged, moved, skipped: [] } — same row shape for merged/moved.
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

    let todayShip = await client.query(`
      SELECT id, shipment_ref FROM fba_shipments
      WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
      ORDER BY created_at DESC LIMIT 1
    `);

    let shipmentId: number;
    let shipmentRef: string;

    if (todayShip.rows.length === 0) {
      const todayIso = await client.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
      const iso = String(todayIso.rows[0]?.d || '').trim();
      shipmentRef = buildFbaPlanRefFromIsoDate(iso);

      const newShip = await client.query(`
        INSERT INTO fba_shipments (shipment_ref, due_date, status)
        VALUES ($1, CURRENT_DATE, 'PLANNED')
        RETURNING id, shipment_ref
      `, [shipmentRef]);

      shipmentId = newShip.rows[0].id;
      shipmentRef = newShip.rows[0].shipment_ref;
    } else {
      shipmentId = todayShip.rows[0].id;
      shipmentRef = todayShip.rows[0].shipment_ref;
    }

    const existingRes = await client.query(
      `SELECT fnsku FROM fba_shipment_items WHERE shipment_id = $1`,
      [shipmentId]
    );
    const existingFnskus = new Set<string>(existingRes.rows.map((r) => r.fnsku));

    type LineOut = {
      fnsku: string;
      expected_qty: number;
      item_id: number;
      display_title: string;
    };

    const added: LineOut[] = [];
    const merged: LineOut[] = [];
    const moved: LineOut[] = [];
    const skipped: { fnsku: string; reason: string }[] = [];

    const deleteWaForItems = async (itemIds: number[]) => {
      if (itemIds.length === 0) return;
      await client.query(
        `DELETE FROM work_assignments
         WHERE entity_type = 'FBA_SHIPMENT' AND entity_id = ANY($1::int[])`,
        [itemIds]
      );
    };

    for (const item of items) {
      const fnsku = String(item.fnsku || '').trim().toUpperCase();
      if (!fnsku) continue;

      const qty = Math.max(1, Number(item.expected_qty) || 1);

      const othersRes = await client.query<{ id: number; expected_qty: number }>(
        `SELECT fsi.id, fsi.expected_qty
         FROM fba_shipment_items fsi
         JOIN fba_shipments fs ON fs.id = fsi.shipment_id
         WHERE fsi.fnsku = $1
           AND fs.id <> $2
           AND fs.status = 'PLANNED'
           AND fsi.status = 'PLANNED'
         ORDER BY fs.due_date ASC NULLS LAST, fsi.id ASC`,
        [fnsku, shipmentId]
      );
      const otherRows = othersRes.rows;
      const otherIds = otherRows.map((r) => r.id);

      if (existingFnskus.has(fnsku)) {
        if (otherIds.length > 0) {
          await deleteWaForItems(otherIds);
          await client.query(`DELETE FROM fba_shipment_items WHERE id = ANY($1::int[])`, [otherIds]);
        }
        const bumpRes = await client.query<{
          id: number;
          fnsku: string;
          expected_qty: number;
          display_title: string;
        }>(
          `UPDATE fba_shipment_items fsi
           SET expected_qty = $1::int,
               updated_at = NOW()
           WHERE fsi.shipment_id = $2 AND fsi.fnsku = $3
           RETURNING
             fsi.id,
             fsi.fnsku,
             fsi.expected_qty,
             COALESCE(
               NULLIF(TRIM(fsi.product_title), ''),
               (SELECT ff.product_title FROM fba_fnskus ff WHERE ff.fnsku = fsi.fnsku),
               fsi.fnsku
             ) AS display_title`,
          [qty, shipmentId, fnsku]
        );
        const row = bumpRes.rows[0];
        if (row) {
          merged.push({
            fnsku: row.fnsku,
            expected_qty: Number(row.expected_qty),
            item_id: row.id,
            display_title: String(row.display_title || row.fnsku),
          });
        }
        continue;
      }

      if (otherRows.length > 0) {
        const keepId = otherRows[0].id;
        const restIds = otherRows.slice(1).map((r) => r.id);
        const totalQty = qty;
        if (restIds.length > 0) {
          await deleteWaForItems(restIds);
          await client.query(`DELETE FROM fba_shipment_items WHERE id = ANY($1::int[])`, [restIds]);
        }
        const moveRes = await client.query<{
          id: number;
          fnsku: string;
          expected_qty: number;
          display_title: string;
        }>(
          `UPDATE fba_shipment_items fsi
           SET shipment_id = $1,
               expected_qty = $2::int,
               updated_at = NOW()
           WHERE fsi.id = $3
           RETURNING
             fsi.id,
             fsi.fnsku,
             fsi.expected_qty,
             COALESCE(
               NULLIF(TRIM(fsi.product_title), ''),
               (SELECT ff.product_title FROM fba_fnskus ff WHERE ff.fnsku = fsi.fnsku),
               fsi.fnsku
             ) AS display_title`,
          [shipmentId, totalQty, keepId]
        );
        await client.query(
          `UPDATE work_assignments
           SET deadline_at = (CURRENT_DATE + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz
           WHERE entity_type = 'FBA_SHIPMENT' AND entity_id = $1`,
          [keepId]
        );
        const row = moveRes.rows[0];
        if (row) {
          moved.push({
            fnsku: row.fnsku,
            expected_qty: Number(row.expected_qty),
            item_id: row.id,
            display_title: String(row.display_title || row.fnsku),
          });
        }
        existingFnskus.add(fnsku);
        continue;
      }

      const catalogRow = await upsertFnskuCatalogRow(client, {
        fnsku,
        productTitle: item.product_title,
        asin: item.asin,
        sku: item.sku,
      });
      // Use the resolved FNSKU from the catalog — when a B0 ASIN is scanned and
      // an existing catalog row maps that ASIN to a real X00 FNSKU, catalogRow.fnsku
      // will be the real FNSKU rather than the B0 value.
      const resolvedFnsku = String(catalogRow?.fnsku || fnsku).trim().toUpperCase();
      const catalogTitle = catalogRow?.product_title ?? null;
      const catalogAsin = catalogRow?.asin ?? null;
      const catalogSku = catalogRow?.sku ?? null;

      const itemRes = await client.query(
        `INSERT INTO fba_shipment_items
           (shipment_id, fnsku, expected_qty, product_title, asin, sku, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PLANNED')
         RETURNING id`,
        [shipmentId, resolvedFnsku, qty, catalogTitle, catalogAsin, catalogSku]
      );
      const itemId: number = itemRes.rows[0].id;

      await client.query(
        `INSERT INTO work_assignments
           (entity_type, entity_id, work_type, status, priority, deadline_at)
         VALUES ('FBA_SHIPMENT', $1, 'PACK', 'OPEN', 1,
                 (CURRENT_DATE + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz)`,
        [itemId]
      );

      const displayTitle = (catalogTitle && String(catalogTitle).trim()) || fnsku;

      added.push({
        fnsku,
        expected_qty: qty,
        item_id: itemId,
        display_title: displayTitle,
      });
      existingFnskus.add(fnsku);
    }

    await client.query(
      `UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1`,
      [shipmentId]
    );

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-stage-counts']);
    await publishFbaShipmentChanged({ action: 'items-added', shipmentId: Number(shipmentId || 0), source: 'fba.shipments.today-items' });

    return NextResponse.json({
      success: true,
      shipment_id: shipmentId,
      shipment_ref: shipmentRef,
      plan_ref: shipmentRef,
      added,
      merged,
      moved,
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
