/**
 * POST /api/admin/staff/[id]/enroll-token
 *
 * Generates a one-time enrollment token for the given staff and returns the
 * QR target URL. Admin shows this QR; staff scans it on their phone, sets a
 * PIN, optionally registers a passkey.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { createEnrollment } from '@/lib/auth/enrollment';
import { audit } from '@/lib/auth/audit';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // /api/admin/staff/[id]/enroll-token → grab the id before 'enroll-token'.
  const idIdx = parts.findIndex((p) => p === 'enroll-token') - 1;
  const id = idIdx >= 0 ? Number(parts[idIdx]) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  const enr = await createEnrollment({
    staffId: id,
    createdBy: ctx.staffId,
    ttlHours: 24,
  });

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'enrollment.created', result: 'ok',
    detail: { targetStaffId: id, expiresAt: enr.expiresAt },
  });

  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    req.nextUrl.origin
  ).replace(/\/+$/, '');

  return NextResponse.json({
    token: enr.token,
    expiresAt: enr.expiresAt,
    url: `${origin}/m/enroll/${enr.token}`,
  });
}, { permission: 'admin.manage_staff' });
