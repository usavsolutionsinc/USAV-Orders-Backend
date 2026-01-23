import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/skip - Skip an order for a technician
 */
export async function POST(req: NextRequest) {
  try {
    const { orderId, techId } = await req.json();

    if (!orderId || !techId) {
      return NextResponse.json(
        { error: 'orderId and techId are required' },
        { status: 400 }
      );
    }

    // Update skipped_by column by appending the techId to the JSON array
    // We use COALESCE and ensure it's a valid JSON array
    await pool.query(
      `UPDATE orders 
       SET skipped_by = (
         CASE 
           WHEN skipped_by IS NULL OR skipped_by = '' OR skipped_by = '[]' 
           THEN jsonb_build_array($2::text)
           ELSE (skipped_by::jsonb || jsonb_build_array($2::text))::text
         END
       )
       WHERE id = $1`,
      [orderId, techId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error skipping order:', error);
    return NextResponse.json(
      { error: 'Failed to skip order', details: error.message },
      { status: 500 }
    );
  }
}
