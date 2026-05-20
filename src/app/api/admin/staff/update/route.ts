/**
 * POST /api/admin/staff/update
 *
 * Updates name/role/active/default_home_path on a staff row, scoped to the
 * caller's tenant. Refuses to operate on staff from another org (the WHERE
 * clause filters by organization_id; no row updated → 404).
 *
 * Body: { id, name?, role?, active?, defaultHomePath? }
 *
 * Gated by admin.manage_staff.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

const Body = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().min(1).max(50).optional(),
  active: z.boolean().optional(),
  defaultHomePath: z.string().max(120).nullable().optional(),
});

export const POST = withAuth(async (req, ctx) => {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'INVALID_INPUT', detail: err instanceof Error ? err.message : 'bad request' },
      { status: 400 },
    );
  }

  // Build the SET clause dynamically — Postgres has no nicer way that's
  // also injection-safe than parameterizing each field we actually set.
  const sets: string[] = [];
  const args: unknown[] = [];
  function setField(col: string, value: unknown) {
    args.push(value);
    sets.push(`${col} = $${args.length}`);
  }
  if (parsed.name !== undefined)            setField('name', parsed.name);
  if (parsed.role !== undefined)            setField('role', parsed.role);
  if (parsed.active !== undefined)          setField('active', parsed.active);
  if (parsed.defaultHomePath !== undefined) setField('default_home_path', parsed.defaultHomePath);

  if (sets.length === 0) {
    return NextResponse.json({ error: 'NO_FIELDS' }, { status: 400 });
  }

  args.push(parsed.id);
  args.push(ctx.organizationId);
  const r = await pool.query(
    `UPDATE staff SET ${sets.join(', ')}
      WHERE id = $${args.length - 1} AND organization_id = $${args.length}
      RETURNING id, name, role, COALESCE(active, true) AS active, default_home_path`,
    args,
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ staff: r.rows[0] });
}, {
  permission: 'admin.manage_staff',
  audit: {
    source: 'admin',
    action: 'staff.update',
    entityType: 'staff',
    entityId: ({ body }) => (body as { id?: number })?.id ?? null,
  },
});
