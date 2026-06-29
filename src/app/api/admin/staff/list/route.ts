/**
 * GET /api/admin/staff/list
 *
 * Tenant-scoped staff directory for the admin UI. Returns the columns the
 * staff-management table needs: name, role, status, has_pin, last_login.
 * Never returns pin_hash or anything from the integrations vault.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

interface Row {
  id: number;
  name: string;
  role: string;
  status: string;
  active: boolean;
  has_pin: boolean;
  last_login_at: Date | null;
  default_home_path: string | null;
  color_hex: string;
  auth_method: string;
  requires_sensitive_stepup: boolean;
}

export const GET = withAuth(async (_req, ctx) => {
  // auth_method / requires_sensitive_stepup (WS6.1) are read via to_jsonb so the
  // query is safe BEFORE the 2026-06-28_staff_auth_policy migration is applied:
  // a missing column yields a NULL key → COALESCE defaults ('pin' / false).
  const r = await tenantQuery<Row>(
    ctx.organizationId,
    `SELECT s.id, s.name, s.role, s.status, COALESCE(s.active, true) AS active,
            (s.pin_hash IS NOT NULL) AS has_pin,
            s.last_login_at, s.default_home_path, s.color_hex,
            COALESCE(to_jsonb(s) ->> 'auth_method', 'pin') AS auth_method,
            COALESCE((to_jsonb(s) ->> 'requires_sensitive_stepup')::boolean, false) AS requires_sensitive_stepup
       FROM staff s
      WHERE s.organization_id = $1
      ORDER BY s.status DESC, s.name ASC`,
    [ctx.organizationId],
  );
  return NextResponse.json({ staff: r.rows });
}, { permission: 'admin.manage_staff' });
