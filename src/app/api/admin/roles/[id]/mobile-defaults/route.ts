/**
 * PATCH /api/admin/roles/[id]/mobile-defaults
 *
 * Body:
 *   { config: MobileDisplayConfigInput | null }
 *
 * REPLACE semantics for the JSONB column. Pass `null` (or `{}`) to clear
 * the role's defaults — staff in the role fall back to the system default
 * (bottom nav disabled).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { invalidateRoleCache } from '@/lib/auth/role-store';
import { sanitizeMobileDisplayConfig } from '@/lib/auth/mobile-display-config';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'mobile-defaults') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (!('config' in body)) {
    return NextResponse.json({ error: 'MISSING_CONFIG' }, { status: 400 });
  }
  const raw = (body as { config: unknown }).config;
  const clean = raw === null ? null : sanitizeMobileDisplayConfig(raw);

  // `roles` is GLOBAL (no organization_id) — no org predicate; routed through
  // the tenant connection for GUC parity.
  const existsR = await tenantQuery(ctx.organizationId, `SELECT id, key FROM roles WHERE id = $1 LIMIT 1`, [id]);
  if (!existsR.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const r = await tenantQuery(
    ctx.organizationId,
    `UPDATE roles
        SET mobile_defaults = $2::jsonb,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, key, mobile_defaults`,
    [id, clean ? JSON.stringify(clean) : null],
  );

  // Cached roles snapshot includes mobile_defaults — drop so the next read
  // resolves the new value for every staff in this role.
  invalidateRoleCache();

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'role.mobile_defaults.changed', result: 'ok',
    detail: { roleId: id, key: (existsR.rows[0] as { key: string }).key, config: clean },
  });

  return NextResponse.json({ role: r.rows[0] });
}, { permission: 'admin.manage_roles' });
