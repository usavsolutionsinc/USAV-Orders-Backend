import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export interface ShippedFormData {
  order_id: string;
  product_title: string;
  reason: string;
  condition: string;
  sku?: string;
}

/**
 * POST /api/shipped/submit
 * Create a new shipped entry with combined product_title - reason.
 * Tracking is linked separately via shipment_id once the packer scans.
 */
export async function POST(req: NextRequest) {
  try {
    const body: ShippedFormData = await req.json();

    const {
      order_id,
      product_title,
      reason,
      condition,
      sku,
    } = body;

    // Validate required fields
    if (!order_id || !product_title || !reason || !condition) {
      return NextResponse.json(
        { error: 'order_id, product_title, reason, and condition are required', success: false },
        { status: 400 }
      );
    }

    // Combine reason with product_title ([Reason] - [Product Title])
    const finalProductTitle = `${reason} - ${product_title}`;

    // Get current timestamp in MM/DD/YYYY HH:mm:ss format (24-hour) in PST
    const formattedDate = formatPSTTimestamp();

    // Insert the order row (tracking linked later via shipment_id)
    const insertResult = await pool.query(
      `INSERT INTO orders (order_id, product_title, condition, sku, status, created_at)
       VALUES ($1, $2, $3, $4, 'shipped', NOW())
       RETURNING id`,
      [order_id, finalProductTitle, condition, sku?.trim() || null]
    );
    const insertedId = insertResult.rows[0]?.id ?? null;

    await invalidateCacheTags(['shipped', 'orders']);
    return NextResponse.json({
      success: true,
      message: 'Shipped entry created successfully',
      id: insertedId,
      data: {
        order_id,
        product_title: finalProductTitle,
        condition,
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
