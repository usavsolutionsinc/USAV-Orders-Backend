import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tracking = String(body?.tracking || '').trim();
    const techIdRaw = body?.techId;
    const techId = Number.isFinite(Number(techIdRaw)) ? Number(techIdRaw) : null;

    if (!tracking) {
      return NextResponse.json({ success: false, error: 'Tracking is required' }, { status: 400 });
    }

    const params: any[] = [tracking];
    let techFilter = '';
    if (techId) {
      params.push(techId);
      techFilter = ` AND tested_by = $${params.length} `;
    }

    const latestResult = await pool.query(
      `SELECT id, serial_number
       FROM tech_serial_numbers
       WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(COALESCE($1, ''), '\\D', '', 'g'), 8)
         AND serial_number IS NOT NULL
         AND serial_number != ''
         ${techFilter}
       ORDER BY test_date_time DESC NULLS LAST, id DESC
       LIMIT 1`,
      params
    );

    if (latestResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'No scanned serial found to undo' }, { status: 404 });
    }

    const row = latestResult.rows[0];
    await pool.query('DELETE FROM tech_serial_numbers WHERE id = $1', [row.id]);

    const remainingResult = await pool.query(
      `SELECT serial_number
       FROM tech_serial_numbers
       WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(COALESCE($1, ''), '\\D', '', 'g'), 8)
         AND serial_number IS NOT NULL
         AND serial_number != ''
       ORDER BY test_date_time ASC NULLS LAST, id ASC`,
      [tracking]
    );

    return NextResponse.json({
      success: true,
      removedSerial: row.serial_number,
      serialNumbers: remainingResult.rows.map((r: any) => r.serial_number),
    });
  } catch (error: any) {
    console.error('Undo last scan error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to undo latest scan' },
      { status: 500 }
    );
  }
}

