/**
 * GET /api/admin/sessions
 *
 * Lists every active staff session for the admin "active sessions" view.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

export const GET = withAuth(async () => {
  const r = await pool.query(
    `SELECT s.sid, s.staff_id, st.name AS staff_name,
            s.device_kind, s.device_label, s.ip::text AS ip,
            s.created_at, s.last_seen_at, s.expires_at
       FROM staff_sessions s
       JOIN staff st ON st.id = s.staff_id
      WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
      ORDER BY s.last_seen_at DESC`,
  );
  return NextResponse.json({ sessions: r.rows });
}, { permission: 'admin.view_sessions' });
