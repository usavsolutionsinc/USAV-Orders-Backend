import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fnskuParam = searchParams.get('fnsku');
  const techId = searchParams.get('techId');

  if (!fnskuParam) {
    return NextResponse.json({ error: 'FNSKU is required' }, { status: 400 });
  }

  if (!techId) {
    return NextResponse.json({ error: 'Tech ID is required' }, { status: 400 });
  }

  try {
    const fnsku = fnskuParam.trim().toUpperCase();
    const techIdNum = parseInt(techId, 10);
    if (!techIdNum) {
      return NextResponse.json({ error: 'Invalid Tech ID' }, { status: 400 });
    }

    const staffResult = await pool.query(
      `SELECT id FROM staff WHERE id = $1 LIMIT 1`,
      [techIdNum]
    );
    if (staffResult.rows.length === 0) {
      return NextResponse.json({ error: 'Tech not found in staff table' }, { status: 404 });
    }
    const testedBy = staffResult.rows[0].id;

    let fnskuResult;
    try {
      fnskuResult = await pool.query(
        `SELECT product_title
         FROM fba_fnskus
         WHERE UPPER(TRIM(fnsku)) = $1
         LIMIT 1`,
        [fnsku]
      );
    } catch (err: any) {
      if (err?.code !== '42P01') {
        throw err;
      }
      // Fallback for singular table naming
      fnskuResult = await pool.query(
        `SELECT product_title
         FROM fba_fnsku
         WHERE UPPER(TRIM(fnsku)) = $1
         LIMIT 1`,
        [fnsku]
      );
    }

    if (fnskuResult.rows.length === 0) {
      return NextResponse.json({ found: false, error: 'FNSKU not found in fba_fnskus table' });
    }

    const productTitle = fnskuResult.rows[0].product_title || 'Unknown Product';

    const existingTracking = await pool.query(
      `SELECT id
       FROM tech_serial_numbers
       WHERE UPPER(TRIM(shipping_tracking_number)) = $1
       LIMIT 1`,
      [fnsku]
    );

    if (existingTracking.rows.length === 0) {
      await pool.query(
        `INSERT INTO tech_serial_numbers (
          shipping_tracking_number, serial_number, serial_type, tested_by
        ) VALUES ($1, $2, $3, $4)`,
        [fnsku, null, 'FNSKU', testedBy]
      );
    }

    const serialsResult = await pool.query(
      `SELECT serial_number
       FROM tech_serial_numbers
       WHERE UPPER(TRIM(shipping_tracking_number)) = $1
         AND serial_number IS NOT NULL
         AND serial_number <> ''
       ORDER BY test_date_time ASC`,
      [fnsku]
    );

    return NextResponse.json({
      found: true,
      orderFound: false,
      order: {
        id: null,
        orderId: 'FNSKU',
        productTitle,
        itemNumber: null,
        sku: 'N/A',
        condition: 'N/A',
        notes: '',
        tracking: fnsku,
        serialNumbers: serialsResult.rows.map((r: any) => r.serial_number),
        testDateTime: null,
        testedBy,
        accountSource: 'fba',
        quantity: 1,
        status: null,
        statusHistory: [],
        isShipped: false,
        packerId: null,
        testerId: null,
        outOfStock: null,
        shipByDate: null,
        orderDate: null,
        createdAt: null
      }
    });
  } catch (error: any) {
    console.error('Error scanning FNSKU:', error);
    return NextResponse.json(
      {
        error: 'Failed to scan FNSKU',
        details: error.message
      },
      { status: 500 }
    );
  }
}
