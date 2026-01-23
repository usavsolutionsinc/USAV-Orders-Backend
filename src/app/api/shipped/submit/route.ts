import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export interface ShippedFormData {
  order_id: string;
  product_title: string;
  reason: string;
  shipping_tracking_number: string;
  sku: string;
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
      shipping_tracking_number,
      sku,
    } = body;

    // Validate required fields
    if (!order_id || !product_title || !reason || !shipping_tracking_number || !sku) {
      return NextResponse.json(
        { error: 'All fields are required', success: false },
        { status: 400 }
      );
    }

    // Combine reason with product_title (reason first)
    const finalProductTitle = `${reason} ${product_title}`;

    // Get current timestamp
    const now = new Date().toISOString();

    // Insert into shipped table
    const result = await pool.query(
      `INSERT INTO shipped (date_time, order_id, product_title, shipping_tracking_number, sku)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [now, order_id, finalProductTitle, shipping_tracking_number, sku]
    );

    const insertedId = result.rows[0]?.id;

    return NextResponse.json({
      success: true,
      message: 'Shipped entry created successfully',
      id: insertedId,
      data: {
        order_id,
        product_title: finalProductTitle,
        shipping_tracking_number,
        sku,
        date_time: now,
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
