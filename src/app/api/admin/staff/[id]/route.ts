/**
 *   PATCH  /api/admin/staff/[id]   — change name, status, employee_code,
 *                                    default_home_path[_mobile], session_policy
 *   DELETE /api/admin/staff/[id]   — soft-disable (sets status='disabled', revokes sessions)
 *
 * NOTE: this endpoint NO LONGER writes `staff.role`. The legacy single-role
 * column is now a derived mirror of `staff_roles[0].key` and is kept in sync
 * by PUT /api/admin/staff/[id]/roles. Every UI flow that changes roles must
 * go through that endpoint — there is no "primary role select" anymore.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { revokeAllSessionsForStaff, SESSION_POLICIES, type SessionPolicy } from '@/lib/auth/session';

export const runtime = 'nodejs';

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const url = new URL(req.url);
  const id = Number(url.pathname.split('/').filter(Boolean).pop());
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof body.name === 'string' && body.name.trim()) {
    params.push(body.name.trim()); updates.push(`name = $${params.length}`);
  }
  if (typeof body.status === 'string') {
    const allowed = ['active', 'invited', 'suspended', 'disabled'];
    if (!allowed.includes(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS', allowed }, { status: 400 });
    }
    params.push(body.status); updates.push(`status = $${params.length}`);
  }
  if ('employeeCode' in body) {
    params.push((body.employeeCode as string | null) ?? null);
    updates.push(`employee_code = $${params.length}`);
  }
  // Per-staff landing-page overrides. Both desktop and mobile are nullable;
  // null means "fall back to ROLE_HOME / MOBILE_ROLE_HOME for the role". Any
  // non-null value must be a path starting with "/" — the DB CHECK constraint
  // enforces the same shape, we just give a friendlier error here.
  for (const [bodyKey, column] of [
    ['defaultHomePath', 'default_home_path'],
    ['defaultHomePathMobile', 'default_home_path_mobile'],
  ] as const) {
    if (bodyKey in body) {
      const raw = body[bodyKey];
      if (raw === null || raw === '') {
        params.push(null); updates.push(`${column} = $${params.length}`);
      } else if (typeof raw === 'string' && raw.startsWith('/') && raw.length <= 120) {
        params.push(raw); updates.push(`${column} = $${params.length}`);
      } else {
        return NextResponse.json({ error: 'INVALID_HOME_PATH', field: bodyKey }, { status: 400 });
      }
    }
  }
  if (typeof body.sessionPolicy === 'string') {
    if (!SESSION_POLICIES.includes(body.sessionPolicy as SessionPolicy)) {
      return NextResponse.json(
        { error: 'INVALID_SESSION_POLICY', allowed: SESSION_POLICIES },
        { status: 400 },
      );
    }
    params.push(body.sessionPolicy); updates.push(`session_policy = $${params.length}`);
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });
  }
  params.push(id);
  const r = await pool.query(
    `UPDATE staff SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, name, role, status, employee_code, session_policy,
               default_home_path, default_home_path_mobile`,
    params,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.updated', result: 'ok',
    detail: { targetStaffId: id, updates },
  });

  // Status changes (and any soft-disable) should drop existing sessions so
  // the user re-signs. Role mutations no longer flow through this endpoint.
  const updatedRow = r.rows[0] as { status: string };
  if (updates.some((u) => u.startsWith('status')) || updatedRow.status !== 'active') {
    await revokeAllSessionsForStaff(id);
  }

  return NextResponse.json({ staff: r.rows[0] });
}, { permission: 'admin.manage_staff' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const url = new URL(req.url);
  const id = Number(url.pathname.split('/').filter(Boolean).pop());
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }
  await pool.query(`UPDATE staff SET status = 'disabled', active = false WHERE id = $1`, [id]);
  await revokeAllSessionsForStaff(id);
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.disabled', result: 'ok',
    detail: { targetStaffId: id },
  });
  return NextResponse.json({ ok: true });
}, { permission: 'admin.manage_staff' });
