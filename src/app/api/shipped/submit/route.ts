import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export interface ShippedFormData {
  order_id: string;
  product_title: string;
  reason: string;
  condition: string;
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
      condition,
      shipping_tracking_number,
      sku,
    } = body;

    // Validate required fields
    if (!order_id || !product_title || !reason || !condition || !shipping_tracking_number || !sku) {
      return NextResponse.json(
        { error: 'All fields are required', success: false },
        { status: 400 }
      );
    }

    // Combine reason with product_title ([Reason] - [Product Title])
    const finalProductTitle = `${reason} - ${product_title}`;

    // Get current timestamp in MM/DD/YYYY HH:mm:ss format (24-hour)
    const now = new Date();
    const formattedDate = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    // Insert into orders table or update existing order to is_shipped = true
    const result = await pool.query(
      `INSERT INTO orders (order_id, product_title, condition, shipping_tracking_number, sku, is_shipped, pack_date_time)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (order_id) 
       DO UPDATE SET 
         product_title = EXCLUDED.product_title,
         condition = EXCLUDED.condition,
         shipping_tracking_number = EXCLUDED.shipping_tracking_number,
         sku = EXCLUDED.sku,
         is_shipped = true,
         pack_date_time = EXCLUDED.pack_date_time
       RETURNING id`,
      [order_id, finalProductTitle, condition, shipping_tracking_number, sku, formattedDate]
    );

    const insertedId = result.rows[0]?.id;

    return NextResponse.json({
      success: true,
      message: 'Shipped entry created successfully',
      id: insertedId,
      data: {
        order_id,
        product_title: finalProductTitle,
        condition,
        shipping_tracking_number,
        sku,
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
