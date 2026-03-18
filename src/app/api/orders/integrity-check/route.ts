import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingNumber } from '@/lib/shipping/normalize';

export const dynamic = 'force-dynamic';

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * POST /api/orders/integrity-check
 *
 * Integrity check: deduplicate orders only when the same order_id is linked
 * to the same tracking number more than once.
 * Industry-standard pattern: report-first (dryRun) then fix.
 *
 * - dryRun: true = report only, no deletes
 * - dryRun: false or omit = deduplicate (keep most complete row per group, delete rest)
 *
 * Only groups rows when BOTH are present:
 * - order_id
 * - tracking number (via shipment_id -> shipping_tracking_numbers)
 *
 * Rows are deleted only when multiple orders share the same order_id AND the
 * same normalized tracking number. Different order_id values on the same
 * tracking number are not touched. Blank/no-tracking rows are not touched.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;

    const { rows: orders } = await pool.query<{
      id: number;
      order_id: string | null;
      shipment_id: number | null;
      tracking_number_raw: string | null;
      tracking_number_normalized: string | null;
      product_title: string | null;
      condition: string | null;
      item_number: string | null;
      sku: string | null;
      quantity: string | null;
      notes: string | null;
    }>(
      `SELECT
         o.id,
         o.order_id,
         o.shipment_id,
         stn.tracking_number_raw,
         stn.tracking_number_normalized,
         o.product_title,
         o.condition,
         o.item_number,
         o.sku,
         o.quantity,
         o.notes
       FROM orders o
       LEFT JOIN shipping_tracking_numbers stn
         ON stn.id = o.shipment_id
       ORDER BY o.id ASC`
    );

    // Group only by (order_id, tracking) when both values exist.
    const groups = new Map<string, typeof orders>();
    for (const o of orders) {
      const oid = String(o.order_id ?? '').trim();
      const tracking =
        String(o.tracking_number_normalized ?? '').trim() ||
        normalizeTrackingNumber(String(o.tracking_number_raw ?? '').trim());

      if (!oid || !tracking) continue;

      const key = `${oid}::${tracking}`;
      const arr = groups.get(key) ?? [];
      arr.push(o);
      groups.set(key, arr);
    }

    const duplicateGroups = Array.from(groups.entries()).filter(
      ([, arr]) => arr.length > 1
    );

    const ordersToDelete: number[] = [];

    for (const [, arr] of duplicateGroups) {
      const score = (ord: (typeof orders)[0]) =>
        [
          ord.product_title,
          ord.condition,
          ord.item_number,
          ord.sku,
          ord.quantity,
          ord.notes,
        ].filter((v) => !isBlank(v)).length;

      const sorted = [...arr].sort((a, b) => score(b) - score(a));
      const toRemove = sorted.slice(1);
      toRemove.forEach((o) => ordersToDelete.push(o.id));
    }

    if (!dryRun && ordersToDelete.length > 0) {
      for (const id of ordersToDelete) {
        await pool.query('DELETE FROM orders WHERE id = $1', [id]);
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      duplicateGroups: duplicateGroups.length,
      deleted: dryRun ? 0 : ordersToDelete.length,
      wouldDelete: dryRun ? ordersToDelete.length : 0,
      ordersToDelete: dryRun ? ordersToDelete : undefined,
      message:
        dryRun && ordersToDelete.length > 0
          ? `Found ${duplicateGroups.length} duplicate group(s), ${ordersToDelete.length} row(s) would be removed. Run without dryRun to fix.`
          : !dryRun && ordersToDelete.length > 0
            ? `Removed ${ordersToDelete.length} duplicate order(s) from ${duplicateGroups.length} group(s).`
            : duplicateGroups.length === 0
              ? 'No duplicates found.'
              : 'Integrity check complete.',
    });
  } catch (error: any) {
    console.error('[orders/integrity-check]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
