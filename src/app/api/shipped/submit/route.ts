import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/lib/timezone';

export interface ShippedFormData {
  order_id: string;
  product_title: string;
  reason: string;
  condition: string;
  shipping_tracking_number: string;
  sku?: string;
}

/**
 * POST /api/shipped/submit
 * Create a new shipped entry with combined product_title - reason
 */
export async function POST(req: NextRequest) {
  try {
    const body: ShippedFormData = await req.json();
    
    const {
      order_id,
      product_title,
      reason,
      condition,
      shipping_tracking_number,
      sku,
    } = body;

    // Validate required fields
    if (!order_id || !product_title || !reason || !condition || !shipping_tracking_number) {
      return NextResponse.json(
        { error: 'order_id, product_title, reason, condition, and shipping_tracking_number are required', success: false },
        { status: 400 }
      );
    }

    // Combine reason with product_title ([Reason] - [Product Title])
    const finalProductTitle = `${reason} - ${product_title}`;

    // Get current timestamp in MM/DD/YYYY HH:mm:ss format (24-hour) in PST
    const formattedDate = formatPSTTimestamp();

    // Always insert a new row in orders. Matching order_id is lookup-only in UI.
    const insertResult = await pool.query(
      `INSERT INTO orders (order_id, product_title, condition, shipping_tracking_number, sku, is_shipped, created_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       RETURNING id`,
      [order_id, finalProductTitle, condition, shipping_tracking_number, sku?.trim() || null]
    );
    const insertedId = insertResult.rows[0]?.id ?? null;

    return NextResponse.json({
      success: true,
      message: 'Shipped entry created successfully',
      id: insertedId,
      data: {
        order_id,
        product_title: finalProductTitle,
        condition,
        shipping_tracking_number,
        sku: sku?.trim() || null,
        date_time: formattedDate,
      }
    });
  } catch (error: any) {
    console.error('Error submitting shipped entry:', error);
    return NextResponse.json(
      { error: 'Failed to submit shipped entry', details: error.message, success: false },
      { status: 500 }
    );
  }
}
