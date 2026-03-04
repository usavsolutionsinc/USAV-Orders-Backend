import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

function normalizeSerialList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter(Boolean);
}

function detectSerialType(
  serials: string[],
  existingType: string | null | undefined,
  accountSource: string | null | undefined
) {
  if (existingType) return existingType;
  if (accountSource === 'fba') return 'FNSKU';
  return serials.some((serial) => /^X0|^B0/i.test(serial)) ? 'FNSKU' : 'SERIAL';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tracking = String(body?.tracking || '').trim();
    const serialNumbers = normalizeSerialList(body?.serialNumbers);
    const parsedTechId = Number.parseInt(String(body?.techId || ''), 10);
    const techId = Number.isFinite(parsedTechId) && parsedTechId > 0 ? parsedTechId : null;

    if (!tracking) {
      return NextResponse.json({ success: false, error: 'Tracking number is required' }, { status: 400 });
    }

    const key18 = normalizeTrackingKey18(tracking);
    if (!key18 || key18.length < 8) {
      return NextResponse.json({ success: false, error: 'Invalid tracking number' }, { status: 400 });
    }

    const existingExactRow = await pool.query(
      `SELECT id, serial_type, tested_by
       FROM tech_serial_numbers
       WHERE shipping_tracking_number = $1
       ORDER BY id ASC
       LIMIT 1`,
      [tracking]
    );

    const existingRowResult = existingExactRow.rows.length > 0
      ? existingExactRow
      : await pool.query(
          `SELECT id, serial_type, tested_by
           FROM tech_serial_numbers
           WHERE RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
           ORDER BY id ASC
           LIMIT 1`,
          [key18]
        );

    const orderResult = await pool.query(
      `SELECT account_source
       FROM orders
       WHERE shipping_tracking_number IS NOT NULL
         AND shipping_tracking_number != ''
         AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [key18]
    );

    const joinedSerials = serialNumbers.join(', ');

    if (existingRowResult.rows.length > 0) {
      const row = existingRowResult.rows[0];
      const nextTestedBy = techId ?? (row.tested_by ? Number(row.tested_by) : null);
      await pool.query(
        `UPDATE tech_serial_numbers
         SET serial_number = $1,
             serial_type = $2,
             test_date_time = date_trunc('second', NOW()),
             tested_by = $3
         WHERE id = $4`,
        [
          joinedSerials,
          detectSerialType(serialNumbers, row.serial_type, orderResult.rows[0]?.account_source),
          nextTestedBy,
          row.id,
        ]
      );
    } else if (serialNumbers.length > 0) {
      await pool.query(
        `INSERT INTO tech_serial_numbers
         (shipping_tracking_number, serial_number, serial_type, test_date_time, tested_by)
         VALUES ($1, $2, $3, date_trunc('second', NOW()), $4)`,
        [
          tracking,
          joinedSerials,
          detectSerialType(serialNumbers, null, orderResult.rows[0]?.account_source),
          techId,
        ]
      );
    }

    await invalidateCacheTags(['tech-logs', 'orders-next', 'shipped', 'orders']);

    return NextResponse.json({
      success: true,
      serialNumbers,
    });
  } catch (error: any) {
    console.error('Error updating serials:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update serials',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
