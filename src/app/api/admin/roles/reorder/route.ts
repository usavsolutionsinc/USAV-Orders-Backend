/**
 * PATCH /api/admin/roles/reorder
 *
 * Body: { order: number[] }   — role ids in the desired top-down order.
 *                               First id gets position=1, next gets 2, …
 *
 * Why renumber instead of accepting per-row positions: keeps the editor
 * simple (drag-and-drop produces an array) and avoids needing a CHECK
 * constraint or gap-management. The drag-handle is in the sidebar; the
 * editor calls this once per drop.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { invalidateRoleCache } from '@/lib/auth/role-store';

export const runtime = 'nodejs';

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const orderRaw = (body as { order?: unknown }).order;
  if (!Array.isArray(orderRaw)) {
    return NextResponse.json({ error: 'INVALID_REQUEST', field: 'order' }, { status: 400 });
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const v of orderRaw) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    ids.push(Math.floor(n));
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: 'EMPTY_ORDER' }, { status: 400 });
  }

  // One UPDATE statement, using a VALUES table for the new positions. Each
  // role's new position is its 1-indexed slot in the input array.
  const valueParts: string[] = [];
  const params: unknown[] = [];
  ids.forEach((id, i) => {
    params.push(id, i + 1);
    valueParts.push(`($${params.length - 1}::INT, $${params.length}::INT)`);
  });
  await pool.query(
    `UPDATE roles r
        SET position = v.position,
            updated_at = NOW()
       FROM (VALUES ${valueParts.join(', ')}) AS v(id, position)
      WHERE r.id = v.id`,
    params,
  );

  invalidateRoleCache();
  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'role.reordered', result: 'ok',
    detail: { order: ids },
  });
  return NextResponse.json({ ok: true, count: ids.length });
}, { permission: 'admin.manage_roles' });
