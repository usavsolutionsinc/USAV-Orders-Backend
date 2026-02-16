import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tracking = String(body?.tracking || '').trim();

    if (!tracking) {
      return NextResponse.json({ success: false, error: 'Tracking is required' }, { status: 400 });
    }

    const result = await pool.query(
      `DELETE FROM tech_serial_numbers
       WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(COALESCE($1, ''), '\\D', '', 'g'), 8)`,
      [tracking]
    );

    return NextResponse.json({
      success: true,
      deletedCount: result.rowCount || 0,
    });
  } catch (error: any) {
    console.error('Delete tech tracking error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete tech tracking records' },
      { status: 500 }
    );
  }
}
