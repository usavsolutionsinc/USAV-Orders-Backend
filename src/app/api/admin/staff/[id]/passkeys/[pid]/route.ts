/**
 * DELETE /api/admin/staff/[id]/passkeys/[pid] — revoke a single passkey.
 *
 * If the revoked passkey was the only WebAuthn credential the staff had,
 * future sign-ins fall back to PIN. We don't touch sessions or the PIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';

export const runtime = 'nodejs';

function parsePath(req: NextRequest): { staffId: number; passkeyId: number } | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const passkeyIdx = parts.length - 1;
  const passkeyAnchor = parts.findIndex((p) => p === 'passkeys');
  if (passkeyAnchor < 0) return null;
  const staffId = Number(parts[passkeyAnchor - 1]);
  const passkeyId = Number(parts[passkeyIdx]);
  if (!Number.isFinite(staffId) || staffId <= 0) return null;
  if (!Number.isFinite(passkeyId) || passkeyId <= 0) return null;
  return { staffId, passkeyId };
}

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const parsed = parsePath(req);
  if (!parsed) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });

  const r = await pool.query(
    `DELETE FROM staff_passkeys
      WHERE id = $1 AND staff_id = $2
      RETURNING id`,
    [parsed.passkeyId, parsed.staffId],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'passkey.revoked_by_admin', result: 'ok',
    detail: { targetStaffId: parsed.staffId, passkeyId: parsed.passkeyId },
  });

  return NextResponse.json({ ok: true });
}, { permission: 'admin.manage_staff' });
