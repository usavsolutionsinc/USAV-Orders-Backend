/**
 * GET /api/admin/audit?limit=200&staffId=…
 *
 * Recent auth_audit rows. Joined to staff to surface the actor's name.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

export const GET = withAuth(async (req: NextRequest) => {
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 200)));
  const staffIdParam = req.nextUrl.searchParams.get('staffId');
  const staffId = staffIdParam ? Number(staffIdParam) : null;

  const params: unknown[] = [limit];
  let where = '';
  if (staffId && Number.isFinite(staffId)) {
    params.push(staffId);
    where = `WHERE a.staff_id = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT a.id, a.staff_id, st.name AS staff_name,
            a.event, a.result, a.ip::text AS ip, a.sid,
            a.detail, a.created_at
       FROM auth_audit a
       LEFT JOIN staff st ON st.id = a.staff_id
       ${where}
      ORDER BY a.created_at DESC
      LIMIT $1`,
    params,
  );
  return NextResponse.json({ entries: r.rows });
}, { permission: 'admin.view_logs' });
