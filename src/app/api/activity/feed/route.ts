import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const since = searchParams.get('since') || null;

    const params: any[] = [limit];
    let sinceClause = '';
    if (since) {
      sinceClause = 'AND sal.created_at > $2';
      params.push(since);
    }

    const result = await pool.query(
      `SELECT
        sal.id,
        sal.station,
        sal.activity_type,
        sal.staff_id,
        s.name AS staff_name,
        sal.scan_ref,
        sal.fnsku,
        sal.shipment_id,
        sal.notes,
        sal.created_at
      FROM station_activity_logs sal
      LEFT JOIN staff s ON s.id = sal.staff_id
      WHERE 1=1 ${sinceClause}
      ORDER BY sal.created_at DESC
      LIMIT $1`,
      params
    );

    return NextResponse.json({
      success: true,
      activities: result.rows.map((row: any) => ({
        id: Number(row.id),
        station: row.station,
        activity_type: row.activity_type,
        staff_id: row.staff_id ? Number(row.staff_id) : null,
        staff_name: row.staff_name || null,
        scan_ref: row.scan_ref || null,
        fnsku: row.fnsku || null,
        shipment_id: row.shipment_id ? Number(row.shipment_id) : null,
        notes: row.notes || null,
        created_at: row.created_at,
      })),
    });
  } catch (error: any) {
    console.error('[activity/feed] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch activity feed' },
      { status: 500 }
    );
  }
}
