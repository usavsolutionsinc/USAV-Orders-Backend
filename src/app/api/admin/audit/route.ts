/**
 * GET /api/admin/audit?limit=200&staffId=…
 *
 * Recent auth_audit rows. Joined to staff to surface the actor's name.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthContext } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

export const GET = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const orgId = ctx.organizationId;
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 200)));
  const staffIdParam = req.nextUrl.searchParams.get('staffId');
  const staffId = staffIdParam ? Number(staffIdParam) : null;

  // auth_audit has no organization_id of its own; it is scoped via its parent
  // staff row. Force an INNER JOIN to staff in this org so rows belonging to
  // another tenant's staff (or unattributed rows) never surface here.
  const params: unknown[] = [limit, orgId];
  let where = `WHERE st.organization_id = $2`;
  if (staffId && Number.isFinite(staffId)) {
    params.push(staffId);
    where += ` AND a.staff_id = $${params.length}`;
  }

  const r = await tenantQuery(
    orgId,
    `SELECT a.id, a.staff_id, st.name AS staff_name,
            a.event, a.result, a.ip::text AS ip, a.sid,
            a.detail, a.created_at
       FROM auth_audit a
       JOIN staff st ON st.id = a.staff_id AND st.organization_id = $2
       ${where}
      ORDER BY a.created_at DESC
      LIMIT $1`,
    params,
  );
  return NextResponse.json({ entries: r.rows });
}, { permission: 'admin.view_logs' });
