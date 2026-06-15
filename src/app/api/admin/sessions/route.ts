/**
 * GET /api/admin/sessions
 *
 * Lists every active staff session for the admin "active sessions" view.
 */

import { NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req, ctx) => {
  // Tenant ownership filter — never list another org's sessions. The
  // staff_sessions ↔ staff join is on the integer surrogate PK (safe bare).
  const r = await tenantQuery(
    ctx.organizationId,
    `SELECT s.sid, s.staff_id, st.name AS staff_name,
            s.device_kind, s.device_label, s.ip::text AS ip,
            s.created_at, s.last_seen_at, s.expires_at
       FROM staff_sessions s
       JOIN staff st ON st.id = s.staff_id
      WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
        AND s.organization_id = $1
      ORDER BY s.last_seen_at DESC`,
    [ctx.organizationId],
  );
  return NextResponse.json({ sessions: r.rows });
}, { permission: 'admin.view_sessions' });
