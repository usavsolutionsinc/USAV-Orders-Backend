/**
 * GET    /api/admin/staff/[id]/sessions   — list active sessions
 * DELETE /api/admin/staff/[id]/sessions   — revoke all active sessions
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { revokeAllSessionsForStaff } from '@/lib/auth/session';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'sessions') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const GET = withAuth(async (req: NextRequest) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  const r = await pool.query(
    `SELECT sid, device_kind, device_label, ip::text AS ip,
            created_at, last_seen_at, expires_at
       FROM staff_sessions
      WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_seen_at DESC`,
    [id],
  );
  return NextResponse.json({ sessions: r.rows });
}, { permission: 'admin.view_sessions' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  const count = await revokeAllSessionsForStaff(id);
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'sessions.revoked_all_by_admin', result: 'ok',
    detail: { targetStaffId: id, count },
  });
  return NextResponse.json({ ok: true, count });
}, { permission: 'admin.view_sessions' });
