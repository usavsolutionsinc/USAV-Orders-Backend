/**
 * Admin staff management.
 *   GET  /api/admin/staff           — list all (active + invited + disabled)
 *   POST /api/admin/staff           — create a new invited staff row
 *
 * Both require admin.manage_staff. The legacy /api/staff endpoint is left
 * untouched so existing consumers keep working.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { canonicalRole, ALL_ROLES, type StaffRole } from '@/lib/auth/permissions';
import { invalidateStaffRolesCache } from '@/lib/auth/role-store';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { wouldExceedPlanCeiling, planLimitResponseBody } from '@/lib/billing/plan-ceilings';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req, ctx) => {
  const orgId = ctx.organizationId;
  // staff is tenant-owned: only list staff in the caller's org. The
  // passkey_count subquery anchors on the parent staff row (s.id), which is
  // already org-filtered, so it cannot count another tenant's passkeys
  // (staff_passkeys itself has no organization_id).
  const r = await tenantQuery(
    orgId,
    `SELECT id, name, role, status, active, employee_id, employee_code, sort_order,
            (pin_hash IS NOT NULL) AS has_pin,
            (SELECT COUNT(*)::INT FROM staff_passkeys p WHERE p.staff_id = s.id) AS passkey_count,
            last_login_at, created_at
       FROM staff s
      WHERE s.organization_id = $1
      ORDER BY sort_order ASC NULLS LAST, name ASC`,
    [orgId],
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

  // Plan ceiling: a new staff row consumes a seat. Dormant until
  // PLAN_FEATURE_ENFORCED; dogfood org exempt; fail-open (see plan-ceilings.ts).
  if (await wouldExceedPlanCeiling(ctx.organizationId, 'maxStaff')) {
    return NextResponse.json(planLimitResponseBody('maxStaff'), { status: 403 });
  }

  // Create the staff row AND its matching `staff_roles` assignment in one
  // transaction. Effective permissions are resolved from `staff_roles × roles`
  // (see current-user.ts) — the `staff.role` column is only a display-label
  // fallback. Inserting the staff row alone leaves the new hire with an empty
  // permission set, so every gated route 403s even though the UI shows their
  // role. Roles can still be edited afterward via PUT /api/admin/staff/[id]/roles.
  //
  // staff is tenant-owned: stamp the new row with the caller's org so an admin
  // can never create staff into another tenant. The staff_roles assignment is
  // gated by this freshly-created (org-stamped) staff parent; `roles` is a
  // system-global table so it carries no org predicate of its own.
  const orgId = ctx.organizationId;
  const created = await withTenantTransaction(orgId, async (client) => {
    const r = await client.query(
      `INSERT INTO staff (name, role, status, employee_code, active, organization_id)
       VALUES ($1, $2, 'invited', $3, true, $4)
       RETURNING id, name, role, status, employee_code`,
      [name, canonical, employeeCode, orgId],
    );
    const row = r.rows[0] as { id: number; name: string; role: string; status: string };
    await client.query(
      `INSERT INTO staff_roles (staff_id, role_id, granted_at, granted_by)
       SELECT $1, r.id, NOW(), $3 FROM roles r WHERE r.key = $2
       ON CONFLICT (staff_id, role_id) DO NOTHING`,
      [row.id, canonical, ctx.staffId ?? null],
    );
    return row;
  });
  invalidateStaffRolesCache(created.id);
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.created', result: 'ok',
    detail: { newStaffId: created.id, role: canonical },
  });
  return NextResponse.json({ staff: created });
}, { permission: 'admin.manage_staff' });
