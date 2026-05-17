/**
 *   PATCH  /api/admin/staff/[id]   — change name, role, status, employee_code
 *   DELETE /api/admin/staff/[id]   — soft-disable (sets status='disabled', revokes sessions)
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { revokeAllSessionsForStaff } from '@/lib/auth/session';
import { canonicalRole, ALL_ROLES, type StaffRole } from '@/lib/auth/permissions';

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
  if (typeof body.role === 'string') {
    const canonical = canonicalRole(body.role.trim().toLowerCase() as StaffRole);
    if (canonical === 'unknown' || !ALL_ROLES.includes(canonical)) {
      return NextResponse.json({ error: 'INVALID_ROLE', allowed: ALL_ROLES }, { status: 400 });
    }
    params.push(canonical); updates.push(`role = $${params.length}`);
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
  if (updates.length === 0) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });
  }
  params.push(id);
  const r = await pool.query(
    `UPDATE staff SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, name, role, status, employee_code`,
    params,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.updated', result: 'ok',
    detail: { targetStaffId: id, updates },
  });

  // Role/status changes should drop existing sessions so the user re-signs.
  const updatedRow = r.rows[0] as { status: string };
  if (updates.some((u) => u.startsWith('role') || u.startsWith('status')) || updatedRow.status !== 'active') {
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
