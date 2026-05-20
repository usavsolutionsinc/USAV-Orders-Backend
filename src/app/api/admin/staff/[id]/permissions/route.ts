/**
 * PATCH /api/admin/staff/[id]/permissions
 *
 * Body: { add?: string[], remove?: string[] }   — REPLACE semantics for the
 *                                                 two override arrays.
 *
 * If `add` (or `remove`) is omitted, that column is left as-is. Pass `[]`
 * to clear. Admin rows reject changes — admin keeps full access by role.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { ALL_PERMISSIONS, isAdminRoleKey } from '@/lib/auth/permissions-shared';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'permissions') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Returns null if the caller omitted the field (meaning "leave column as-is").
 * Returns { valid, unknown } otherwise — caller must reject when unknown is non-empty.
 */
function partition(raw: unknown): { valid: string[]; unknown: string[] } | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return { valid: [], unknown: [] };
  const valid: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 64) continue;
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (ALL_PERMISSIONS.has(trimmed as never)) {
      valid.push(trimmed);
    } else {
      unknown.push(trimmed);
    }
  }
  return { valid, unknown };
}

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const addPart = partition((body as { add?: unknown }).add);
  const removePart = partition((body as { remove?: unknown }).remove);
  if (addPart === null && removePart === null) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });
  }

  // Phase 2a write-time validation: reject any submitted permission that
  // isn't in the registry. Without this, unknown strings would be silently
  // dropped on read and the admin would think the override was applied.
  const unknownAll = [...(addPart?.unknown ?? []), ...(removePart?.unknown ?? [])];
  if (unknownAll.length > 0) {
    return NextResponse.json(
      { error: 'UNKNOWN_PERMISSIONS', unknown: unknownAll, message: `Rejected: ${unknownAll.length} permission(s) not registered.` },
      { status: 400 },
    );
  }
  const add = addPart?.valid ?? null;
  const remove = removePart?.valid ?? null;

  // Refuse to mutate admin's overrides — admin role grants everything; the
  // override columns are meaningless and the UI shouldn't be sending them.
  const roleR = await pool.query(`SELECT role FROM staff WHERE id = $1`, [id]);
  const row = roleR.rows[0] as { role: string } | undefined;
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (isAdminRoleKey(row.role)) {
    return NextResponse.json({ error: 'ADMIN_ROLE_IMMUTABLE_OVERRIDES' }, { status: 409 });
  }

  const sets: string[] = [];
  const params: unknown[] = [id];
  if (add !== null) {
    params.push(add);
    sets.push(`permissions_added = $${params.length}::TEXT[]`);
  }
  if (remove !== null) {
    params.push(remove);
    sets.push(`permissions_removed = $${params.length}::TEXT[]`);
  }
  const r = await pool.query(
    `UPDATE staff SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, permissions_added, permissions_removed`,
    params,
  );

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.permissions.changed', result: 'ok',
    detail: { targetStaffId: id, add, remove },
  });

  return NextResponse.json({ staff: r.rows[0] });
}, { permission: 'admin.manage_staff' });
