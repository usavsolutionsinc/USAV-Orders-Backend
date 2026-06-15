/**
 * GET    /api/admin/roles/[id] — single role + member list
 * PATCH  /api/admin/roles/[id] — partial update (label, color, position, permissions)
 *                                Admin role rejects permission changes.
 * DELETE /api/admin/roles/[id] — only allowed when !is_system AND member_count == 0.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { invalidateRoleCache, invalidateStaffRolesCache } from '@/lib/auth/role-store';
import { ALL_PERMISSIONS, isAdminRoleKey } from '@/lib/auth/permissions-shared';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || !ALL_PERMISSIONS.has(t as never) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  // `roles` is GLOBAL (no organization_id) — fetched without an org filter.
  // Both the member_count and the member list are staff-derived, so they are
  // scoped to THIS org through the org-owned `staff` parent of staff_roles.
  const [roleR, membersR] = await withTenantTransaction(ctx.organizationId, async (client) => {
    const roleQ = client.query(
      `SELECT r.id, r.key, r.label, r.color, r.position, r.permissions, r.is_system,
              r.mobile_defaults,
              r.created_at, r.updated_at,
              COALESCE(c.cnt, 0)::INT AS member_count
         FROM roles r
         LEFT JOIN (
           SELECT sr.role_id, COUNT(*)::INT AS cnt
             FROM staff_roles sr
             JOIN staff s ON s.id = sr.staff_id
            WHERE s.organization_id = $2
            GROUP BY sr.role_id
         ) c ON c.role_id = r.id
        WHERE r.id = $1`,
      [id, ctx.organizationId],
    );
    const membersQ = client.query(
      `SELECT s.id, s.name, s.role, s.status,
              sr.granted_at, sr.granted_by
         FROM staff_roles sr
         JOIN staff s ON s.id = sr.staff_id
        WHERE sr.role_id = $1
          AND s.organization_id = $2
        ORDER BY s.name ASC`,
      [id, ctx.organizationId],
    );
    return Promise.all([roleQ, membersQ]);
  });
  if (!roleR.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ role: roleR.rows[0], members: membersR.rows });
}, { permission: 'admin.manage_roles' });

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  // Load the existing row so we can enforce the admin-role guardrail and
  // compute a diff for the audit detail. `roles` is GLOBAL (no organization_id)
  // — no org predicate; routed through the tenant connection for GUC parity.
  const cur = await tenantQuery(ctx.organizationId, `SELECT id, key, is_system, permissions FROM roles WHERE id = $1`, [id]);
  const row = cur.rows[0] as { id: number; key: string; is_system: boolean; permissions: string[] } | undefined;
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sets: string[] = [];
  const params: unknown[] = [];

  if (typeof body.label === 'string' && body.label.trim()) {
    params.push(body.label.trim()); sets.push(`label = $${params.length}`);
  }
  if (typeof body.color === 'string') {
    if (!HEX_RE.test(body.color)) return NextResponse.json({ error: 'INVALID_COLOR' }, { status: 400 });
    params.push(body.color); sets.push(`color = $${params.length}`);
  }
  if (Number.isFinite(Number(body.position))) {
    params.push(Math.max(0, Math.floor(Number(body.position)))); sets.push(`position = $${params.length}`);
  }
  if (Array.isArray(body.permissions)) {
    if (isAdminRoleKey(row.key)) {
      return NextResponse.json({ error: 'ADMIN_ROLE_PERMISSIONS_IMMUTABLE', message: 'Admin role grants every permission; it cannot be customized.' }, { status: 409 });
    }
    // Phase 2a write-time validation: reject any submitted permission that
    // isn't in the runtime registry. Without this, unknown strings would be
    // silently dropped at request time and the admin would think they saved
    // a grant that has no effect.
    const submitted: string[] = (body.permissions as unknown[]).map(String);
    const unknown = submitted.filter((p) => !ALL_PERMISSIONS.has(p as never));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'UNKNOWN_PERMISSIONS', unknown, message: `Rejected: ${unknown.length} permission(s) not registered.` },
        { status: 400 },
      );
    }
    params.push(sanitizePermissions(body.permissions));
    sets.push(`permissions = $${params.length}::TEXT[]`);
  }
  if (sets.length === 0) return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });

  sets.push(`updated_at = NOW()`);
  params.push(id);
  const r = await tenantQuery(
    ctx.organizationId,
    `UPDATE roles SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, key, label, color, position, permissions, is_system, created_at, updated_at`,
    params,
  );

  invalidateRoleCache();
  // Permission changes affect every staff in this role. Easiest correctness:
  // clear the staff-roles cache wholesale; it'll lazily refill within 60s
  // anyway.
  invalidateStaffRolesCache();

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'role.updated', result: 'ok',
    detail: { roleId: id, key: row.key, fields: sets.filter((s) => !s.startsWith('updated_at')).map((s) => s.split(' = ')[0]) },
  });

  return NextResponse.json({ role: r.rows[0] });
}, { permission: 'admin.manage_roles' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  // `roles` is GLOBAL (no organization_id) — the role row is read without an
  // org filter. The in-use gate, however, must count only THIS org's members
  // (staff_roles → org-owned staff), so cross-tenant assignments don't leak
  // into this admin's delete decision.
  const cur = await tenantQuery(
    ctx.organizationId,
    `SELECT r.id, r.key, r.is_system,
            COALESCE(c.cnt, 0)::INT AS member_count
       FROM roles r
       LEFT JOIN (
         SELECT sr.role_id, COUNT(*)::INT AS cnt
           FROM staff_roles sr
           JOIN staff s ON s.id = sr.staff_id
          WHERE s.organization_id = $2
          GROUP BY sr.role_id
       ) c ON c.role_id = r.id
      WHERE r.id = $1`,
    [id, ctx.organizationId],
  );
  const row = cur.rows[0] as { id: number; key: string; is_system: boolean; member_count: number } | undefined;
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (row.is_system) {
    return NextResponse.json({ error: 'IS_SYSTEM', message: 'Built-in roles cannot be deleted.' }, { status: 409 });
  }
  if (row.member_count > 0) {
    return NextResponse.json({ error: 'ROLE_IN_USE', memberCount: row.member_count, message: 'Remove all members before deleting this role.' }, { status: 409 });
  }

  await tenantQuery(ctx.organizationId, `DELETE FROM roles WHERE id = $1`, [id]);
  invalidateRoleCache();
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'role.deleted', result: 'ok',
    detail: { roleId: id, key: row.key },
  });
  return NextResponse.json({ ok: true });
}, { permission: 'admin.manage_roles' });
