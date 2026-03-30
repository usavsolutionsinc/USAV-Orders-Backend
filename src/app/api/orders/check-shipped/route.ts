import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';

// Shipped state is now derived from station_activity_logs (SAL).
// This endpoint updates status = 'shipped' for orders that have any SAL row
// linked via shipment_id — SAL is the source of truth for station scans.
export async function POST() {
  try {
    const result = await pool.query(`
      UPDATE orders o
      SET status = 'shipped'
      WHERE o.shipment_id IS NOT NULL
        AND (o.status IS NULL OR o.status != 'shipped')
        AND EXISTS (
          SELECT 1 FROM station_activity_logs sal
          WHERE sal.shipment_id IS NOT NULL
            AND sal.shipment_id = o.shipment_id
        )
      RETURNING o.id
    `);

    await invalidateCacheTags(['orders', 'orders-next', 'shipped', 'packing-logs']);

    const updatedIds = (result.rows || []).map((r: any) => Number(r.id)).filter(Number.isFinite);
    if (updatedIds.length > 0) {
      await publishOrderChanged({ orderIds: updatedIds, source: 'orders.check-shipped' });
    }

    return NextResponse.json({
      success: true,
      updatedCount: result.rowCount || 0,
      message:
        (result.rowCount || 0) > 0
          ? `Marked status=shipped on ${result.rowCount} order${result.rowCount === 1 ? '' : 's'} with packer logs`
          : 'No matching orders needed status update',
    });
  } catch (error: any) {
    console.error('Check shipped orders error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to check shipped orders',
      },
      { status: 500 }
    );
  }
}
