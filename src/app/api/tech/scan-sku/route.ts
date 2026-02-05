import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { skuCode, tracking, techId } = await req.json();
    
    if (!skuCode || !tracking || !techId) {
      return NextResponse.json({ 
        success: false, 
        error: 'skuCode, tracking, and techId are required' 
      }, { status: 400 });
    }
    
    // Parse SKU code: "12345:ABC" or "12345x3:ABC"
    const parts = skuCode.split(':');
    if (parts.length !== 2) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid SKU format. Use SKU:identifier or SKUxN:identifier' 
      });
    }
    
    let skuToMatch = parts[0].trim();
    let qtyToDecrement = 1;
    
    // Check for xN notation (e.g., "12345x3")
    const xMatch = skuToMatch.match(/^(.+?)x(\d+)$/i);
    if (xMatch) {
      skuToMatch = xMatch[1];
      qtyToDecrement = parseInt(xMatch[2], 10) || 1;
    }
    
    // Get staff ID
    const techEmployeeIds: { [key: string]: string } = {
      '1': 'TECH001',
      '2': 'TECH002',
      '3': 'TECH003',
      '4': 'TECH004'
    };
    const employeeId = techEmployeeIds[techId] || 'TECH001';
    
    const staffResult = await pool.query(
      'SELECT id FROM staff WHERE employee_id = $1',
      [employeeId]
    );
    
    if (staffResult.rows.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Staff not found' 
      }, { status: 404 });
    }
    
    const staffId = staffResult.rows[0].id;
    
    // Look up SKU in sku table
    const skuResult = await pool.query(
      `SELECT id, serial_number, product_title, notes 
       FROM sku 
       WHERE static_sku = $1
       LIMIT 1`,
      [skuCode]
    );
    
    if (skuResult.rows.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: `SKU ${skuCode} not found in sku table` 
      });
    }
    
    const skuRecord = skuResult.rows[0];
    const serialNumbers = skuRecord.serial_number 
      ? skuRecord.serial_number.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    
    // Get order by tracking number
    const last8 = tracking.slice(-8).toLowerCase();
    const orderResult = await pool.query(
      `SELECT id, shipping_tracking_number FROM orders 
       WHERE RIGHT(LOWER(shipping_tracking_number), 8) = $1`,
      [last8]
    );
    
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Order not found' 
      });
    }
    
    const order = orderResult.rows[0];
    
    // Insert each serial as SKU_STATIC type into tech_serial_numbers
    const insertedSerials: string[] = [];
    for (const serial of serialNumbers) {
      const upperSerial = serial.toUpperCase();
      
      // Check for duplicate
      const dupCheck = await pool.query(
        `SELECT id FROM tech_serial_numbers 
         WHERE shipping_tracking_number = $1 AND serial_number = $2`,
        [order.shipping_tracking_number, upperSerial]
      );
      
      if (dupCheck.rows.length === 0) {
        await pool.query(
          `INSERT INTO tech_serial_numbers 
           (shipping_tracking_number, serial_number, serial_type, test_date_time, tester_id)
           VALUES ($1, $2, 'SKU_STATIC', NOW(), $3)`,
          [order.shipping_tracking_number, upperSerial, staffId]
        );
        insertedSerials.push(upperSerial);
      }
    }
    
    // Decrease stock in sku_stock table
    await pool.query(
      `UPDATE sku_stock 
       SET stock = GREATEST(0, CAST(stock AS INTEGER) - $1)::TEXT
       WHERE sku = $2`,
      [qtyToDecrement, skuToMatch]
    );
    
    // Update sku table with tracking number
    await pool.query(
      `UPDATE sku 
       SET shipping_tracking_number = $1 
       WHERE id = $2`,
      [tracking, skuRecord.id]
    );
    
    // Get updated serial list for this order
    const updatedSerials = await pool.query(
      `SELECT serial_number FROM tech_serial_numbers 
       WHERE shipping_tracking_number = $1 
       ORDER BY test_date_time ASC`,
      [order.shipping_tracking_number]
    );
    
    return NextResponse.json({
      success: true,
      serialNumbers: insertedSerials,
      productTitle: skuRecord.product_title,
      notes: skuRecord.notes,
      quantityDecremented: qtyToDecrement,
      updatedSerials: updatedSerials.rows.map((r: any) => r.serial_number)
    });
  } catch (error: any) {
    console.error('SKU scan error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to process SKU scan',
      details: error.message 
    }, { status: 500 });
  }
}
