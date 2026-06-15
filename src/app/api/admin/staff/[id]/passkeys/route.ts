/**
 * GET /api/admin/staff/[id]/passkeys — list registered passkeys.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'passkeys') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  // staff_passkeys has no organization_id of its own — it is child-scoped via
  // staff_id → staff. Gate on the staff PARENT's org: a staffId in another org
  // reads as NOT_FOUND, so an admin can never enumerate another tenant's
  // passkeys.
  const owns = await tenantQuery(
    ctx.organizationId,
    `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`,
    [id, ctx.organizationId],
  );
  if (!owns.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const r = await pool.query(
    `SELECT id, device_label, transports, last_used_at, created_at,
            encode(credential_id, 'base64') AS credential_id
       FROM staff_passkeys
      WHERE staff_id = $1
      ORDER BY created_at DESC`,
    [id],
  );
  return NextResponse.json({ passkeys: r.rows });
}, { permission: 'admin.manage_staff' });
