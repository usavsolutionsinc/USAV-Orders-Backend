import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PendingRow {
  date: string;
  count: number;
  receivingCount: number;
  packingCount: number;
}

export const GET = withAuth(async () => {
  try {
    const { rows } = await pool.query<{
      date: string;
      total: string;
      receiving_n: string;
      packing_n: string;
    }>(
      `SELECT
         to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE entity_type = 'RECEIVING')::text  AS receiving_n,
         COUNT(*) FILTER (WHERE entity_type = 'PACKER_LOG')::text AS packing_n
       FROM photos
       WHERE google_photos_id IS NULL
       GROUP BY 1
       ORDER BY 1 ASC`,
    );

    const pending: PendingRow[] = rows.map((r) => ({
      date: r.date,
      count: Number(r.total),
      receivingCount: Number(r.receiving_n),
      packingCount: Number(r.packing_n),
    }));

    return NextResponse.json({ pending });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/google-photos/pending');
  }
}, { permission: 'admin.view' });
