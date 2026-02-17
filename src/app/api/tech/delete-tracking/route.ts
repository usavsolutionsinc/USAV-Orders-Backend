import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rowId = Number(body?.rowId);

    if (!Number.isFinite(rowId) || rowId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid rowId is required' }, { status: 400 });
    }

    const result = await pool.query(
      `DELETE FROM tech_serial_numbers
       WHERE id = $1`,
      [rowId]
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
