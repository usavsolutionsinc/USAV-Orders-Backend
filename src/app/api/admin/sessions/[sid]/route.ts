/**
 * DELETE /api/admin/sessions/[sid] — revoke a specific session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { revokeSession } from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';

export const runtime = 'nodejs';

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const sid = req.nextUrl.pathname.split('/').filter(Boolean).pop();
  if (!sid) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  await revokeSession(sid);
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'session.revoked', result: 'ok',
    detail: { targetSid: sid },
  });
  return NextResponse.json({ ok: true });
}, { permission: 'admin.view_sessions' });
