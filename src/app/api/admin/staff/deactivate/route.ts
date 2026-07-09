/**
 * POST /api/admin/staff/deactivate
 *
 * Soft-deactivates a staff member: sets active=false, status='deactivated',
 * revokes all active sessions, and unsets their PIN so a leaked PIN can't
 * be re-used.
 *
 * The row stays for audit/history — actual deletion is reserved for the
 * GDPR org-purge flow. Scoped to the caller's tenant.
 *
 * Body: { id }
 *
 * Step-up required because this is a destructive action.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { withTenantTransaction } from '@/lib/tenancy/db';

const Body = z.object({
  id: z.number().int().positive(),
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
  if (parsed.id === ctx.staffId) {
    return NextResponse.json(
      { error: 'CANT_DEACTIVATE_SELF', hint: 'Ask another admin to do this.' },
      { status: 400 },
    );
  }

  const result = await withTenantTransaction(ctx.organizationId, async (client) => {
    const r = await client.query(
      `UPDATE staff
          SET active = false,
              status = 'deactivated',
              pin_hash = NULL,
              pin_failed_count = 0,
              pin_locked_until = NULL
        WHERE id = $1 AND organization_id = $2
        RETURNING id, name`,
      [parsed.id, ctx.organizationId],
    );
    if (r.rowCount === 0) return null;
    await client.query(
      `UPDATE staff_sessions SET revoked_at = now()
        WHERE staff_id = $1 AND revoked_at IS NULL`,
      [parsed.id],
    );
    return r.rows[0] as { id: number; name: string };
  });

  if (!result) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.staffOverrides]);
  return NextResponse.json({ status: 'deactivated', staff: result });
}, {
  permission: 'admin.manage_staff',
  stepUp: true,
  audit: {
    source: 'admin',
    action: 'staff.deactivate',
    entityType: 'staff',
    entityId: ({ body }) => (body as { id?: number })?.id ?? null,
  },
});
