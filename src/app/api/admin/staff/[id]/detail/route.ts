/**
 * GET /api/admin/staff/[id]/detail
 *
 * Full envelope for the admin StaffAccessDetail view: staff row including
 * override columns, current passkey list, active sessions, last 20 audit
 * entries. One round-trip per detail open.
 *
 * Lives at `/detail` rather than overloading GET on the existing
 * `/api/admin/staff/[id]` (which only has PATCH/DELETE today) so the
 * existing route's contract isn't affected.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'detail') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const GET = withAuth(async (req: NextRequest) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const staffQ = pool.query(
    `SELECT id, name, role, status, active, employee_id, employee_code,
            permissions_added, permissions_removed,
            mobile_display_config,
            (pin_hash IS NOT NULL) AS has_pin,
            pin_set_at, pin_locked_until,
            last_login_at, created_at
       FROM staff WHERE id = $1 LIMIT 1`,
    [id],
  );
  const passkeysQ = pool.query(
    `SELECT id,
            encode(credential_id, 'base64') AS credential_id,
            transports, aaguid::text, device_label, last_used_at, created_at
       FROM staff_passkeys
      WHERE staff_id = $1
      ORDER BY created_at DESC`,
    [id],
  );
  const sessionsQ = pool.query(
    `SELECT sid, device_kind, device_label, ip::text AS ip,
            created_at, last_seen_at, expires_at
       FROM staff_sessions
      WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_seen_at DESC`,
    [id],
  );
  const auditQ = pool.query(
    `SELECT id, event, result, ip::text AS ip, sid, detail, created_at
       FROM auth_audit
      WHERE staff_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [id],
  );
  const rolesQ = pool.query(
    `SELECT r.id, r.key, r.label, r.color, r.position, r.permissions, r.is_system,
            r.mobile_defaults,
            sr.granted_at, sr.granted_by
       FROM staff_roles sr
       JOIN roles r ON r.id = sr.role_id
      WHERE sr.staff_id = $1
      ORDER BY r.position ASC, r.id ASC`,
    [id],
  );
  const allRolesQ = pool.query(
    `SELECT id, key, label, color, position, permissions, is_system, mobile_defaults
       FROM roles
      ORDER BY position ASC, id ASC`,
  );

  const [staffR, passkeysR, sessionsR, auditR, rolesR, allRolesR] = await Promise.all([
    staffQ, passkeysQ, sessionsQ, auditQ, rolesQ, allRolesQ,
  ]);
  const staff = staffR.rows[0];
  if (!staff) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({
    staff,
    passkeys: passkeysR.rows,
    sessions: sessionsR.rows,
    audit: auditR.rows,
    roles: rolesR.rows,
    availableRoles: allRolesR.rows,
  });
}, { permission: 'admin.manage_staff' });
