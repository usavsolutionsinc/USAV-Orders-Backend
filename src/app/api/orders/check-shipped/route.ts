import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export async function POST() {
  try {
    const result = await pool.query(`
      UPDATE orders o
      SET
        is_shipped = true,
        status = 'shipped'
      WHERE COALESCE(o.is_shipped, false) = false
        AND o.shipping_tracking_number IS NOT NULL
        AND o.shipping_tracking_number != ''
        AND EXISTS (
          SELECT 1
          FROM packer_logs pl
          WHERE pl.shipping_tracking_number IS NOT NULL
            AND pl.shipping_tracking_number != ''
            AND RIGHT(
              regexp_replace(UPPER(COALESCE(pl.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'),
              18
            ) = RIGHT(
              regexp_replace(UPPER(COALESCE(o.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'),
              18
            )
        )
      RETURNING o.id
    `);

    await invalidateCacheTags(['orders', 'shipped', 'packing-logs', 'packerlogs']);

    return NextResponse.json({
      success: true,
      updatedCount: result.rowCount || 0,
      message:
        (result.rowCount || 0) > 0
          ? `Marked ${result.rowCount} order${result.rowCount === 1 ? '' : 's'} as shipped`
          : 'No matching unshipped orders found',
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
