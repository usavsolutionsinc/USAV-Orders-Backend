/**
 * GET /api/admin/staff/[id]/roles  — list assigned roles for one staff
 * PUT /api/admin/staff/[id]/roles  — REPLACE the staff's role set
 *
 * Body for PUT: { roleIds: number[] }
 *
 * Idempotent PUT semantics: send the full desired set; the server diffs.
 * Removes any roleIds not in the new set, inserts any that are new, leaves
 * unchanged rows alone. Side-effect: keeps `staff.role` in sync with the
 * primary (lowest-position) role for legacy callers that still read that
 * column directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { invalidateStaffRolesCache } from '@/lib/auth/role-store';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

function staffIdFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'roles') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const staffId = staffIdFromUrl(req);
  if (!staffId) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  // Org-ownership gate: a staffId from another org reads as NOT_FOUND, so an
  // admin can never enumerate another org's staff↔role assignments. `roles`
  // itself is a system-global table (no organization_id) — we gate via the
  // `staff` parent's org, not via roles.
  const probe = await tenantQuery(
    ctx.organizationId,
    `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`,
    [staffId, ctx.organizationId],
  );
  if (!probe.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const r = await pool.query(
    `SELECT r.id, r.key, r.label, r.color, r.position, r.permissions, r.is_system,
            sr.granted_at, sr.granted_by
       FROM staff_roles sr
       JOIN roles r ON r.id = sr.role_id
      WHERE sr.staff_id = $1
      ORDER BY r.position ASC, r.id ASC`,
    [staffId],
  );
  return NextResponse.json({ roles: r.rows });
}, { permission: 'admin.manage_staff' });

export const PUT = withAuth(async (req: NextRequest, ctx) => {
  const staffId = staffIdFromUrl(req);
  if (!staffId) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rawIds = (body as { roleIds?: unknown }).roleIds;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ error: 'INVALID_REQUEST', field: 'roleIds' }, { status: 400 });
  }
  const wanted = new Set<number>();
  for (const v of rawIds) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) wanted.add(Math.floor(n));
  }

  // Org-ownership gate: a staffId from another org reads as NOT_FOUND, never
  // mutated. `staff` carries organization_id; `roles`/`staff_roles` do not, so
  // the staff parent's org is the only tenant boundary for the assignment.
  const probe = await tenantQuery(
    ctx.organizationId,
    `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`,
    [staffId, ctx.organizationId],
  );
  if (!probe.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Verify all requested role ids exist (avoid orphan FK failures + give a
  // clearer error message to the caller). `roles` is system-global — no org
  // predicate here.
  if (wanted.size > 0) {
    const r = await pool.query(`SELECT id FROM roles WHERE id = ANY($1::INT[])`, [Array.from(wanted)]);
    const present = new Set((r.rows as Array<{ id: number }>).map((row) => row.id));
    const missing = Array.from(wanted).filter((id) => !present.has(id));
    if (missing.length > 0) {
      return NextResponse.json({ error: 'UNKNOWN_ROLES', missing }, { status: 400 });
    }
  }

  const current = await pool.query(`SELECT role_id FROM staff_roles WHERE staff_id = $1`, [staffId]);
  const have = new Set<number>((current.rows as Array<{ role_id: number }>).map((row) => row.role_id));

  const toAdd = Array.from(wanted).filter((id) => !have.has(id));
  const toRemove = Array.from(have).filter((id) => !wanted.has(id));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Use a single transaction so a partial failure leaves the assignment set
  // unchanged. Run it under the org GUC: the staff parent is already org-gated
  // by the probe above, and the trailing `staff` UPDATE re-asserts the org
  // predicate so it can never sync a row in another org. `staff_roles`/`roles`
  // have no organization_id, so they remain scoped only by the gated staffId.
  await withTenantTransaction(ctx.organizationId, async (client) => {
    if (toRemove.length > 0) {
      await client.query(
        `DELETE FROM staff_roles WHERE staff_id = $1 AND role_id = ANY($2::INT[])`,
        [staffId, toRemove],
      );
    }
    if (toAdd.length > 0) {
      const values = toAdd.map((_id, i) => `($1, $${i + 3}::INT, NOW(), $2)`).join(', ');
      await client.query(
        `INSERT INTO staff_roles (staff_id, role_id, granted_at, granted_by)
         VALUES ${values}
         ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [staffId, ctx.staffId ?? null, ...toAdd],
      );
    }
    // Sync staff.role with the new primary (lowest-position) role for legacy
    // callers. If the new set is empty, leave staff.role as-is.
    const primary = await client.query(
      `SELECT r.key
         FROM staff_roles sr
         JOIN roles r ON r.id = sr.role_id
        WHERE sr.staff_id = $1
        ORDER BY r.position ASC, r.id ASC
        LIMIT 1`,
      [staffId],
    );
    if (primary.rows[0]?.key) {
      await client.query(
        `UPDATE staff SET role = $2 WHERE id = $1 AND organization_id = $3`,
        [staffId, primary.rows[0].key, ctx.organizationId],
      );
    }
  });

  invalidateStaffRolesCache(staffId);

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.roles.changed', result: 'ok',
    detail: { targetStaffId: staffId, add: toAdd, remove: toRemove },
  });

  return NextResponse.json({ ok: true, added: toAdd, removed: toRemove });
}, { permission: 'admin.manage_staff' });
