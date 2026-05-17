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

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'permissions') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitize(raw: unknown): string[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 64) continue;
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const add = sanitize((body as { add?: unknown }).add);
  const remove = sanitize((body as { remove?: unknown }).remove);
  if (add === null && remove === null) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });
  }

  // Refuse to mutate admin's overrides — admin role grants everything; the
  // override columns are meaningless and the UI shouldn't be sending them.
  const roleR = await pool.query(`SELECT role FROM staff WHERE id = $1`, [id]);
  const row = roleR.rows[0] as { role: string } | undefined;
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (row.role === 'admin') {
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
