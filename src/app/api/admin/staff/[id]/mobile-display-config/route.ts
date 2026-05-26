/**
 * PATCH /api/admin/staff/[id]/mobile-display-config
 *
 * Body:
 *   { config: MobileDisplayConfigInput | null }
 *
 * REPLACE semantics for the JSONB column. Pass `null` (or `{}`) to clear
 * the override and fall fully back to the staff's roles' defaults.
 *
 * Admin role accepts changes — admins use mobile too.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { sanitizeMobileDisplayConfig } from '@/lib/auth/mobile-display-config';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'mobile-display-config') - 1;
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

  // null / undefined / {} all map to "clear the override".
  const clean = raw === null ? null : sanitizeMobileDisplayConfig(raw);

  const existsR = await pool.query(`SELECT id FROM staff WHERE id = $1 LIMIT 1`, [id]);
  if (!existsR.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const r = await pool.query(
    `UPDATE staff
        SET mobile_display_config = $2::jsonb
      WHERE id = $1
      RETURNING id, mobile_display_config`,
    [id, clean ? JSON.stringify(clean) : null],
  );

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.mobile_display_config.changed', result: 'ok',
    detail: { targetStaffId: id, config: clean },
  });

  return NextResponse.json({ staff: r.rows[0] });
}, { permission: 'admin.manage_staff' });
