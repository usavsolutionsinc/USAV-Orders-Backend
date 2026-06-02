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
import { invalidateStaffRolesCache } from '@/lib/auth/role-store';

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

  // Create the staff row AND its matching `staff_roles` assignment in one
  // transaction. Effective permissions are resolved from `staff_roles × roles`
  // (see current-user.ts) — the `staff.role` column is only a display-label
  // fallback. Inserting the staff row alone leaves the new hire with an empty
  // permission set, so every gated route 403s even though the UI shows their
  // role. Roles can still be edited afterward via PUT /api/admin/staff/[id]/roles.
  const client = await pool.connect();
  let created: { id: number; name: string; role: string; status: string };
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO staff (name, role, status, employee_code, active)
       VALUES ($1, $2, 'invited', $3, true)
       RETURNING id, name, role, status, employee_code`,
      [name, canonical, employeeCode],
    );
    created = r.rows[0] as { id: number; name: string; role: string; status: string };
    await client.query(
      `INSERT INTO staff_roles (staff_id, role_id, granted_at, granted_by)
       SELECT $1, r.id, NOW(), $3 FROM roles r WHERE r.key = $2
       ON CONFLICT (staff_id, role_id) DO NOTHING`,
      [created.id, canonical, ctx.staffId ?? null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  invalidateStaffRolesCache(created.id);
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.created', result: 'ok',
    detail: { newStaffId: created.id, role: canonical },
  });
  return NextResponse.json({ staff: created });
}, { permission: 'admin.manage_staff' });
