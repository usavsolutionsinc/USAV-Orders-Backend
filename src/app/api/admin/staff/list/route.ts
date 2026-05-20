/**
 * GET /api/admin/staff/list
 *
 * Tenant-scoped staff directory for the admin UI. Returns the columns the
 * staff-management table needs: name, role, status, has_pin, last_login.
 * Never returns pin_hash or anything from the integrations vault.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

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
}

export const GET = withAuth(async (_req, ctx) => {
  const r = await pool.query<Row>(
    `SELECT id, name, role, status, COALESCE(active, true) AS active,
            (pin_hash IS NOT NULL) AS has_pin,
            last_login_at, default_home_path, color_hex
       FROM staff
      WHERE organization_id = $1
      ORDER BY status DESC, name ASC`,
    [ctx.organizationId],
  );
  return NextResponse.json({ staff: r.rows });
}, { permission: 'admin.manage_staff' });
