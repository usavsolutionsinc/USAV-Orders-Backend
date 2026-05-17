/**
 * PATCH /api/admin/staff/reorder
 *
 * Body: { order: number[] }  — staff ids in the desired top-down order.
 *                              First id gets sort_order=1, next=2, etc.
 *
 * Mirrors the roles reorder pattern at /api/admin/roles/reorder.
 * Permission: admin.manage_staff. Audit event: staff.reordered.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';

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

  const valueParts: string[] = [];
  const params: unknown[] = [];
  ids.forEach((id, i) => {
    params.push(id, i + 1);
    valueParts.push(`($${params.length - 1}::INT, $${params.length}::INT)`);
  });
  await pool.query(
    `UPDATE staff s
        SET sort_order = v.sort_order
       FROM (VALUES ${valueParts.join(', ')}) AS v(id, sort_order)
      WHERE s.id = v.id`,
    params,
  );

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.reordered', result: 'ok',
    detail: { order: ids },
  });
  return NextResponse.json({ ok: true, count: ids.length });
}, { permission: 'admin.manage_staff' });
