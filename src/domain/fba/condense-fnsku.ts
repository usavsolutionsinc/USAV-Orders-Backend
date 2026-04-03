import type { PoolClient } from 'pg';
import { createFbaLog } from '@/lib/fba/createFbaLog';
import { upsertFnskuCatalogRow } from '@/lib/fba/upsert-fnsku-catalog';
import type { AddFnskuResult } from './types';

interface AddFnskuToPlanParams {
  targetPlanId: number;
  fnsku: string;
  expectedQty: number;
  staffId: number | null;
  productTitle?: string | null;
  asin?: string | null;
  sku?: string | null;
}

/**
 * Add an FNSKU to a plan with automatic condensing.
 *
 * Rules:
 *   1. If the FNSKU exists in another **unshipped** plan, move it to the target
 *      plan and merge quantities ("condense").
 *   2. If the FNSKU already exists in the target plan, increment its expected_qty.
 *   3. Otherwise, create a new item row.
 *
 * This enforces the constraint: one FNSKU can only live in one unshipped plan.
 *
 * Must be called inside an existing transaction (caller manages BEGIN/COMMIT).
 */
export async function addFnskuToPlan(
  client: PoolClient,
  params: AddFnskuToPlanParams,
): Promise<AddFnskuResult> {
  const { targetPlanId, expectedQty, staffId } = params;

  // Ensure FNSKU exists in the catalog. When the scanned value is a B0 ASIN
  // and the catalog already maps that ASIN to a real X00 FNSKU, the returned
  // row's `fnsku` will be the real FNSKU.
  const catalogRow = await upsertFnskuCatalogRow(client, {
    fnsku: params.fnsku,
    productTitle: params.productTitle,
    asin: params.asin,
    sku: params.sku,
  });
  const fnsku = String(catalogRow?.fnsku || params.fnsku).trim().toUpperCase();
  const productTitle = catalogRow?.product_title ?? null;
  const asin = catalogRow?.asin ?? null;
  const sku = catalogRow?.sku ?? null;

  // ── Step 1: Check for the FNSKU in other unshipped plans ──────────────
  const otherPlanItem = await client.query(
    `SELECT fsi.id, fsi.shipment_id AS plan_id, fsi.expected_qty, fsi.actual_qty
     FROM fba_shipment_items fsi
     JOIN fba_shipments fs ON fs.id = fsi.shipment_id
     WHERE fsi.fnsku = $1
       AND fs.status != 'SHIPPED'
       AND fsi.shipment_id != $2
     ORDER BY fsi.created_at ASC
     LIMIT 1`,
    [fnsku, targetPlanId],
  );

  if (otherPlanItem.rows.length > 0) {
    const old = otherPlanItem.rows[0];
    const fromPlanId = Number(old.plan_id);
    const oldItemId = Number(old.id);
    const oldExpectedQty = Number(old.expected_qty) || 0;
    const oldActualQty = Number(old.actual_qty) || 0;

    // Check if the target plan already has this FNSKU.
    const targetExisting = await client.query(
      `SELECT id, expected_qty, actual_qty FROM fba_shipment_items
       WHERE shipment_id = $1 AND fnsku = $2`,
      [targetPlanId, fnsku],
    );

    if (targetExisting.rows.length > 0) {
      // Merge into existing target row — sum quantities.
      const targetRow = targetExisting.rows[0];
      const mergedExpected = Number(targetRow.expected_qty) + oldExpectedQty + expectedQty;
      const mergedActual = Number(targetRow.actual_qty) + oldActualQty;

      await client.query(
        `UPDATE fba_shipment_items
         SET expected_qty = $1, actual_qty = $2, updated_at = NOW()
         WHERE id = $3`,
        [mergedExpected, mergedActual, targetRow.id],
      );

      // Delete the old row from the source plan.
      await client.query(`DELETE FROM fba_shipment_items WHERE id = $1`, [oldItemId]);

      await createFbaLog(client, {
        fnsku,
        sourceStage: 'FBA',
        eventType: 'REASSIGNED',
        staffId,
        fbaShipmentId: targetPlanId,
        fbaShipmentItemId: Number(targetRow.id),
        quantity: mergedExpected,
        metadata: { fromPlanId, action: 'condensed_merge' },
      });

      return { action: 'condensed', itemId: Number(targetRow.id), newQty: mergedExpected, fromPlanId };
    }

    // Move the row to the target plan (no existing row there).
    const mergedQty = oldExpectedQty + expectedQty;

    await client.query(
      `UPDATE fba_shipment_items
       SET shipment_id = $1,
           expected_qty = $2,
           product_title = COALESCE($3, product_title),
           asin = COALESCE($4, asin),
           sku = COALESCE($5, sku),
           updated_at = NOW()
       WHERE id = $6`,
      [targetPlanId, mergedQty, productTitle, asin, sku, oldItemId],
    );

    await createFbaLog(client, {
      fnsku,
      sourceStage: 'FBA',
      eventType: 'REASSIGNED',
      staffId,
      fbaShipmentId: targetPlanId,
      fbaShipmentItemId: oldItemId,
      quantity: mergedQty,
      metadata: { fromPlanId, action: 'condensed_move' },
    });

    return { action: 'condensed', itemId: oldItemId, newQty: mergedQty, fromPlanId };
  }

  // ── Step 2: Upsert into target plan (no other unshipped plan has it) ──
  const result = await client.query(
    `INSERT INTO fba_shipment_items
       (shipment_id, fnsku, product_title, asin, sku, expected_qty)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (shipment_id, fnsku) DO UPDATE
       SET expected_qty  = fba_shipment_items.expected_qty + EXCLUDED.expected_qty,
           product_title = COALESCE(EXCLUDED.product_title, fba_shipment_items.product_title),
           asin          = COALESCE(EXCLUDED.asin, fba_shipment_items.asin),
           sku           = COALESCE(EXCLUDED.sku, fba_shipment_items.sku),
           updated_at    = NOW()
     RETURNING id, expected_qty`,
    [targetPlanId, fnsku, productTitle, asin, sku, expectedQty],
  );

  const row = result.rows[0];
  const newQty = Number(row.expected_qty);
  const isNew = newQty === expectedQty;

  return {
    action: isNew ? 'created' : 'incremented',
    itemId: Number(row.id),
    newQty,
  };
}
