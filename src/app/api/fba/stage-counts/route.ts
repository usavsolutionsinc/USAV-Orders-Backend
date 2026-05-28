import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

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
 *     PLANNED:        number,
 *     TESTED:         number,
 *     PACKED:         number,
 *     OUT_OF_STOCK:   number,
 *     LABEL_ASSIGNED: number,
 *   }
 * }
 */
export const GET = withAuth(async () => {
  try {
    const result = await pool.query(`
      SELECT status, COUNT(*) AS cnt
      FROM fba_shipment_items
      WHERE status IN ('PLANNED', 'TESTED', 'PACKED', 'OUT_OF_STOCK', 'LABEL_ASSIGNED')
      GROUP BY status
    `);

    const counts: Record<string, number> = {
      PLANNED:        0,
      TESTED:         0,
      PACKED:         0,
      OUT_OF_STOCK:   0,
      LABEL_ASSIGNED: 0,
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
}, { permission: 'fba.view' });
