import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/fba/stage-counts
 *
 * Returns live item counts grouped by status for all non-completed
 * fba_shipment_items. Drives the accordion section badges in the sidebar.
 *
 * Response:
 * {
 *   success: true,
 *   counts: {
 *     PLANNED:       number,
 *     PACKING:       number,
 *     OUT_OF_STOCK:  number,
 *     READY_TO_GO:   number,
 *   }
 * }
 */
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT status, COUNT(*) AS cnt
      FROM fba_shipment_items
      WHERE status IN ('PLANNED', 'PACKING', 'OUT_OF_STOCK', 'READY_TO_GO')
      GROUP BY status
    `);

    const counts: Record<string, number> = {
      PLANNED:      0,
      PACKING:      0,
      OUT_OF_STOCK: 0,
      READY_TO_GO:  0,
    };

    for (const row of result.rows) {
      counts[row.status] = Number(row.cnt);
    }

    return NextResponse.json({ success: true, counts });
  } catch (error: any) {
    console.error('[GET /api/fba/stage-counts]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed' },
      { status: 500 }
    );
  }
}
