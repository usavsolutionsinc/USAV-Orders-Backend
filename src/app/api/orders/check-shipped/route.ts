import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

// Shipped state is now derived from shipping_tracking_numbers carrier status.
// This endpoint now only updates status = 'shipped' for orders that have a packer log
// linked via shipment_id — no longer writes is_shipped.
export async function POST() {
  try {
    const result = await pool.query(`
      UPDATE orders o
      SET status = 'shipped'
      WHERE o.shipment_id IS NOT NULL
        AND (o.status IS NULL OR o.status != 'shipped')
        AND EXISTS (
          SELECT 1 FROM packer_logs pl
          WHERE pl.shipment_id = o.shipment_id
            AND pl.tracking_type = 'ORDERS'
        )
      RETURNING o.id
    `);

    await invalidateCacheTags(['orders', 'shipped', 'packing-logs', 'packerlogs']);

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
