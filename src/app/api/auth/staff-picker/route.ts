/**
 * GET /api/auth/staff-picker
 *
 * Slim list for the sign-in screen — only staff with status='active', sorted
 * by name, with just enough fields to render the grid. Returns `hasPin` so
 * the UI can disable the PIN button for staff that haven't enrolled yet, and
 * `pinless` so the UI knows whether to skip the PIN pad entirely (controlled
 * by the AUTH_PINLESS_SIGNIN env var for rollouts where staff haven't been
 * issued PINs yet).
 *
 * Multi-tenant: the picker is scoped by the tenant resolved from the
 * `x-tenant-slug` header set by proxy.ts. On the apex/no-subdomain host the
 * USAV tenant is returned for backwards compatibility (USAV's existing UX
 * assumes the root domain points at them). Once tenants migrate to
 * `slug.app.example.com` URLs, the root host will return USAV-only.
 *
 * Public: the picker has to render before sign-in. We expose only id/name/
 * role/hasPin — no email, employee_code, or sensitive columns.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getOrganizationBySlug } from '@/lib/tenancy/organizations';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';

interface Row {
  id: number;
  name: string;
  role: string;
  has_pin: boolean;
  color_hex: string;
}

function isPinlessEnabled(): boolean {
  const v = (process.env.AUTH_PINLESS_SIGNIN ?? '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

async function resolveOrgId(req: NextRequest): Promise<string> {
  const slug = req.headers.get('x-tenant-slug');
  if (!slug) return USAV_ORG_ID; // Apex host → USAV (transitional).
  const org = await getOrganizationBySlug(slug);
  // Unknown slug → empty result rather than leaking another tenant's list.
  return org?.id ?? '00000000-0000-0000-0000-000000000000';
}

export async function GET(req: NextRequest) {
  try {
    const orgId = await resolveOrgId(req);
    const r = await pool.query(
      `SELECT id, name, role, color_hex, (pin_hash IS NOT NULL) AS has_pin
         FROM staff
        WHERE organization_id = $1
          AND COALESCE(status, 'active') IN ('active', 'invited')
          AND COALESCE(active, true) = true
        ORDER BY name ASC`,
      [orgId],
    );
    return NextResponse.json(
      { staff: r.rows as Row[], pinless: isPinlessEnabled() },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/auth/staff-picker] error:', err);
    return NextResponse.json({ staff: [], pinless: isPinlessEnabled() }, { status: 200 });
  }
}
