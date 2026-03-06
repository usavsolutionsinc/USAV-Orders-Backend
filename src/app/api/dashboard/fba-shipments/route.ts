import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;

    const tableExists = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'receiving'
       ) AS exists`
    );
    if (!tableExists.rows[0]?.exists) {
      return NextResponse.json({ success: true, rows: [] });
    }

    const query = `
      SELECT
        r.id,
        r.receiving_tracking_number AS tracking,
        r.carrier,
        r.qa_status,
        r.disposition_code,
        r.condition_grade,
        r.target_channel,
        r.needs_test,
        r.assigned_tech_id,
        s.name AS assigned_tech_name,
        COALESCE(r.received_at::text, r.receiving_date_time::text) AS received_at
      FROM receiving r
      LEFT JOIN staff s ON s.id = r.assigned_tech_id
      WHERE r.receiving_tracking_number IS NOT NULL
        AND r.receiving_tracking_number != ''
        AND UPPER(COALESCE(r.target_channel::text, '')) = 'FBA'
        AND (
          $1 = ''
          OR r.receiving_tracking_number ILIKE '%' || $1 || '%'
          OR COALESCE(s.name, '') ILIKE '%' || $1 || '%'
        )
      ORDER BY r.id DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [q, limit]);

    return NextResponse.json({ success: true, rows: result.rows });
  } catch (error: any) {
    console.error('Failed to fetch FBA shipments:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA shipments' },
      { status: 500 }
    );
  }
}
