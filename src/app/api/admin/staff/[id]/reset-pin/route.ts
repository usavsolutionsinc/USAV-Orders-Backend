/**
 * POST /api/admin/staff/[id]/reset-pin
 *
 * Clears the staff's PIN, sets status='invited', revokes their active
 * sessions, and mints a fresh 24-hour enrollment token. Returns the QR
 * URL the admin should hand to the staff to set a new PIN.
 *
 * Audit event: pin.reset_by_admin
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { createEnrollment } from '@/lib/auth/enrollment';
import { revokeAllSessionsForStaff } from '@/lib/auth/session';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'reset-pin') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  // Org-ownership gate: a staffId in another org reads as NOT_FOUND, never
  // mutated. staffId is org-unique, so the subsequent session revoke and
  // enrollment mint are correctly scoped once ownership is confirmed.
  const probe = await tenantQuery(
    ctx.organizationId,
    `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`,
    [id, ctx.organizationId],
  );
  if (!probe.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Clear PIN + lockout, drop status to 'invited' so the picker shows it.
  await tenantQuery(
    ctx.organizationId,
    `UPDATE staff
        SET pin_hash = NULL,
            pin_set_at = NULL,
            pin_failed_count = 0,
            pin_locked_until = NULL,
            status = 'invited'
      WHERE id = $1 AND organization_id = $2`,
    [id, ctx.organizationId],
  );
  const revoked = await revokeAllSessionsForStaff(id);

  const enrollment = await createEnrollment(
    {
      staffId: id,
      createdBy: ctx.staffId,
      ttlHours: 24,
    },
    ctx.organizationId,
  );

  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    req.nextUrl.origin
  ).replace(/\/+$/, '');

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'pin.reset_by_admin', result: 'ok',
    detail: { targetStaffId: id, revokedSessions: revoked, enrollmentToken: enrollment.token.slice(0, 6) + '…' },
  });

  return NextResponse.json({
    ok: true,
    token: enrollment.token,
    expiresAt: enrollment.expiresAt,
    url: `${origin}/m/enroll/${enrollment.token}`,
    revokedSessions: revoked,
  });
}, { permission: 'admin.manage_staff' });
