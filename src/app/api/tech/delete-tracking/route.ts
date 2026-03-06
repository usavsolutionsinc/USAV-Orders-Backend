import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rowId = Number(body?.rowId);
    const techId = body?.techId ? Number(body.techId) : null;

    if (!Number.isFinite(rowId) || rowId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid rowId is required' }, { status: 400 });
    }

    // Fetch the row before deleting so we know which techId to notify.
    const fetchResult = await pool.query(
      `SELECT tested_by FROM tech_serial_numbers WHERE id = $1 LIMIT 1`,
      [rowId]
    );
    const resolvedTechId: number | null =
      fetchResult.rows[0]?.tested_by ?? techId ?? null;

    const result = await pool.query(
      `DELETE FROM tech_serial_numbers
       WHERE id = $1`,
      [rowId]
    );

    await invalidateCacheTags(['tech-logs', 'orders-next']);

    if (resolvedTechId) {
      await publishTechLogChanged({
        techId: resolvedTechId,
        action: 'delete',
        rowId,
        source: 'tech.delete-tracking',
      });
    }

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
