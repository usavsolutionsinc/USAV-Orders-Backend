/**
 * Admin staff management.
 *   GET  /api/admin/staff           — list all (active + invited + disabled)
 *   POST /api/admin/staff           — create a new invited staff row
 *
 * Both require admin.manage_staff. The legacy /api/staff endpoint is left
 * untouched so existing consumers keep working.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { canonicalRole, ALL_ROLES, type StaffRole } from '@/lib/auth/permissions';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req, ctx) => {
  const r = await pool.query(
    `SELECT id, name, role, status, active, employee_id, employee_code, sort_order,
            (pin_hash IS NOT NULL) AS has_pin,
            (SELECT COUNT(*)::INT FROM staff_passkeys p WHERE p.staff_id = s.id) AS passkey_count,
            last_login_at, created_at
       FROM staff s
      ORDER BY sort_order ASC NULLS LAST, name ASC`,
  );
  return NextResponse.json({
    staff: r.rows,
    actor: ctx.staffId,
  });
}, { permission: 'admin.manage_staff' });

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const name = String((body as { name?: unknown }).name ?? '').trim();
  const roleRaw = String((body as { role?: unknown }).role ?? '').trim().toLowerCase() as StaffRole;
  const employeeCode = ((body as { employeeCode?: unknown }).employeeCode ?? null) as string | null;

  if (!name) return NextResponse.json({ error: 'INVALID_REQUEST', field: 'name' }, { status: 400 });
  const canonical = canonicalRole(roleRaw);
  if (canonical === 'unknown' || !ALL_ROLES.includes(canonical)) {
    return NextResponse.json({ error: 'INVALID_ROLE', allowed: ALL_ROLES }, { status: 400 });
  }

  const r = await pool.query(
    `INSERT INTO staff (name, role, status, employee_code, active)
     VALUES ($1, $2, 'invited', $3, true)
     RETURNING id, name, role, status, employee_code`,
    [name, canonical, employeeCode],
  );
  const created = r.rows[0] as { id: number; name: string; role: string; status: string };
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.created', result: 'ok',
    detail: { newStaffId: created.id, role: canonical },
  });
  return NextResponse.json({ staff: created });
}, { permission: 'admin.manage_staff' });
