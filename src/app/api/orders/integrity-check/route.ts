import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * POST /api/orders/integrity-check
 *
 * Integrity check: deduplicate orders by unique (order_id, tracking).
 * Industry-standard pattern: report-first (dryRun) then fix.
 *
 * - dryRun: true = report only, no deletes
 * - dryRun: false or omit = deduplicate (keep most complete row per group, delete rest)
 *
 * Groups by (order_id, shipment_id). When multiple orders share the same pair,
 * keeps the one with the most filled fields (product_title, condition, sku, etc.).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;

    const { rows: orders } = await pool.query<{
      id: number;
      order_id: string | null;
      shipment_id: number | null;
      product_title: string | null;
      condition: string | null;
      item_number: string | null;
      sku: string | null;
      quantity: string | null;
      notes: string | null;
    }>(
      `SELECT id, order_id, shipment_id, product_title, condition, item_number, sku, quantity, notes
       FROM orders
       ORDER BY id ASC`
    );

    // Group by (order_id, shipment_id)
    const groups = new Map<string, typeof orders>();
    for (const o of orders) {
      const oid = String(o.order_id ?? '').trim();
      const sid = o.shipment_id ?? 0;
      const key = `${oid}::${sid}`;
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
