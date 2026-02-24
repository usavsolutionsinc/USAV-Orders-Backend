import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

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
    
    // Resolve staff primarily by numeric staff.id (current flow), with legacy employee_id fallback.
    const techIdNum = parseInt(String(techId), 10);
    let staffResult = { rows: [] as Array<{ id: number }> };
    if (!Number.isNaN(techIdNum) && techIdNum > 0) {
      const byId = await pool.query(
        'SELECT id FROM staff WHERE id = $1 LIMIT 1',
        [techIdNum]
      );
      if (byId.rows.length > 0) {
        staffResult = byId;
      }
    }

    if (staffResult.rows.length === 0) {
      const techEmployeeIds: { [key: string]: string } = {
        '1': 'TECH001',
        '2': 'TECH002',
        '3': 'TECH003',
        '4': 'TECH004'
      };
      const employeeId = techEmployeeIds[String(techId)] || String(techId);
      const byEmployeeId = await pool.query(
        'SELECT id FROM staff WHERE employee_id = $1 LIMIT 1',
        [employeeId]
      );
      staffResult = byEmployeeId;
    }
    
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
    
    // Get order by tracking key-18
    const key18 = normalizeTrackingKey18(String(tracking || ''));
    if (!key18 || key18.length < 8) {
      return NextResponse.json({
        success: false,
        error: 'Invalid tracking number'
      }, { status: 400 });
    }
    const orderResult = await pool.query(
      `SELECT id, shipping_tracking_number FROM orders 
       WHERE RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1`,
      [key18]
    );
    
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Order not found' 
      });
    }
    
    const order = orderResult.rows[0];
    const parseSerials = (value: string | null | undefined) =>
      String(value || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

    // One-row-per-tracking model: fetch (or create) a single tech_serial_numbers row.
    const rowResult = await pool.query(
      `SELECT id, shipping_tracking_number, serial_number
       FROM tech_serial_numbers
       WHERE RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) =
             RIGHT(regexp_replace(UPPER(COALESCE($1::text, '')), '[^A-Z0-9]', '', 'g'), 18)
       ORDER BY id ASC
       LIMIT 1`,
      [order.shipping_tracking_number]
    );
    const existingRow = rowResult.rows[0] || null;
    const baseTracking = existingRow?.shipping_tracking_number || order.shipping_tracking_number;
    const serialList = parseSerials(existingRow?.serial_number);
    const serialSet = new Set(serialList);
    
    // Append each serial from SKU_STATIC lookup into the same row.
    const insertedSerials: string[] = [];
    for (const serial of serialNumbers) {
      const upperSerial = serial.toUpperCase();
      if (!serialSet.has(upperSerial)) {
        serialSet.add(upperSerial);
        serialList.push(upperSerial);
        insertedSerials.push(upperSerial);
      }
    }

    if (existingRow) {
      await pool.query(
        `UPDATE tech_serial_numbers
         SET serial_number = $1,
             serial_type = 'SKU_STATIC',
             test_date_time = date_trunc('second', NOW()),
             tested_by = $2
         WHERE id = $3`,
        [serialList.join(', '), staffId, existingRow.id]
      );
    } else {
      await pool.query(
        `INSERT INTO tech_serial_numbers
         (shipping_tracking_number, serial_number, serial_type, test_date_time, tested_by)
         VALUES ($1, $2, 'SKU_STATIC', date_trunc('second', NOW()), $3)`,
        [baseTracking, serialList.join(', '), staffId]
      );
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
    
    return NextResponse.json({
      success: true,
      serialNumbers: insertedSerials,
      productTitle: skuRecord.product_title,
      notes: skuRecord.notes,
      quantityDecremented: qtyToDecrement,
      updatedSerials: serialList
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
