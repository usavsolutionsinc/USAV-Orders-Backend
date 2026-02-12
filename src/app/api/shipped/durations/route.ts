import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId');
    const id = searchParams.get('id'); // Backward-compatible fallback

    if (!orderId && !id) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // 1. Get current record from orders table
    const currentResult = orderId
      ? await pool.query('SELECT * FROM orders WHERE order_id = $1 AND is_shipped = true', [orderId])
      : await pool.query('SELECT * FROM orders WHERE id = $1 AND is_shipped = true', [id]);
    if (currentResult.rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    const current = currentResult.rows[0];

    let boxingDuration = 'N/A';
    let testingDuration = 'N/A';

    // 2. Calculate Boxing Duration
    const currentPackResult = await pool.query(
      `SELECT packed_by, pack_date_time
       FROM packer_logs
       WHERE shipping_tracking_number = $1
         AND tracking_type = 'ORDERS'
       ORDER BY pack_date_time DESC NULLS LAST, id DESC
       LIMIT 1`,
      [current.shipping_tracking_number]
    );

    const currentPack = currentPackResult.rows[0];
    if (currentPack?.packed_by && currentPack?.pack_date_time) {
      const prevBoxingResult = await pool.query(
        `SELECT pack_date_time FROM packer_logs
         WHERE packed_by = $1
           AND tracking_type = 'ORDERS'
           AND pack_date_time < $2
         ORDER BY pack_date_time DESC NULLS LAST, id DESC
         LIMIT 1`,
        [currentPack.packed_by, currentPack.pack_date_time]
      );

      if (prevBoxingResult.rows.length > 0) {
        const prevTime = parseDate(prevBoxingResult.rows[0].pack_date_time).getTime();
        const currTime = parseDate(currentPack.pack_date_time).getTime();
        const diffMs = currTime - prevTime;
        boxingDuration = formatDuration(diffMs);
      }
    }

    // 3. Calculate Testing Duration
    if (current.tested_by && current.test_date_time) {
      const prevTestResult = await pool.query(
        `SELECT test_date_time FROM orders
         WHERE tested_by = $1 AND test_date_time < $2 AND test_date_time IS NOT NULL AND test_date_time != ''
         ORDER BY test_date_time DESC LIMIT 1`,
        [current.tested_by, current.test_date_time]
      );

      if (prevTestResult.rows.length > 0) {
        const prevTime = parseDate(prevTestResult.rows[0].test_date_time).getTime();
        const currTime = parseDate(current.test_date_time).getTime();
        const diffMs = currTime - prevTime;
        testingDuration = formatDuration(diffMs);
      }
    }

    return NextResponse.json({ boxingDuration, testingDuration });
  } catch (error: any) {
    console.error('Error calculating durations:', error);
    return NextResponse.json({ error: 'Failed to calculate durations', details: error.message }, { status: 500 });
  }
}

function parseDate(dateStr: string | Date): Date {
  if (dateStr instanceof Date) return dateStr;
  if (dateStr.includes('/')) {
    // Handle M/D/YYYY HH:mm:ss
    const [datePart, timePart] = dateStr.split(' ');
    const [m, d, y] = datePart.split('/').map(Number);
    const [h, min, s] = timePart.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, s);
  }
  return new Date(dateStr);
}

function formatDuration(ms: number): string {
  if (ms < 0) return '---';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }
  
  return `${minutes}m ${seconds}s`;
}
