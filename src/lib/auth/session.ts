/**
 * Server-side opaque sessions in Postgres. Cookie carries only a 32-byte
 * random sid; everything else (staff_id, role, device, expiry, revocation)
 * lives in `staff_sessions`. That means we can revoke a single device or
 * an entire user's sessions instantly — something a JWT can't do without a
 * blocklist.
 *
 * Idle-timeout policy by device_kind (when staff.session_policy='default'):
 *   station  →  8 hr idle, 24 hr absolute  (workstation default, survives a coffee break + lunch)
 *   personal → 12 hr idle, 30 days absolute (the "Remember me" device — long-lived)
 *   phone    →  4 hr idle,  4 hr absolute  (matches Ably token TTL)
 *
 * Per-staff session_policy overrides:
 *   extended   — personal devices get 7d idle / 90d absolute; others unchanged
 *   persistent — no idle, 1 year absolute, sliding (touchSession refreshes it).
 *                Stays signed in indefinitely so long as the staff keeps using
 *                the device. Still revocable from the admin UI.
 */

import { randomBytes } from 'node:crypto';
import pool from '@/lib/db';

export const SESSION_COOKIE_NAME = 'usav_sid';

export type DeviceKind = 'station' | 'personal' | 'phone';
export type SessionPolicy = 'default' | 'extended' | 'persistent';
export const SESSION_POLICIES: readonly SessionPolicy[] = ['default', 'extended', 'persistent'] as const;

export interface SessionRow {
  sid: string;
  staffId: number;
  /** Active tenant for this session — see migrations/2026-05-22_organizations_tenancy.sql. */
  organizationId: string;
  deviceKind: DeviceKind;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface IdleWindow {
  idleMs: number;
  absoluteMs: number;
}

const IDLE_WINDOWS: Record<DeviceKind, IdleWindow> = {
  station:  { idleMs:  8 * 60 * 60 * 1000,    absoluteMs: 24 * 60 * 60 * 1000 },
  personal: { idleMs: 12 * 60 * 60 * 1000,    absoluteMs: 30 * 24 * 60 * 60 * 1000 },
  phone:    { idleMs:  4 * 60 * 60 * 1000,    absoluteMs:  4 * 60 * 60 * 1000 },
};

const EXTENDED_PERSONAL: IdleWindow = {
  idleMs:     7 * 24 * 60 * 60 * 1000,
  absoluteMs: 90 * 24 * 60 * 60 * 1000,
};

const PERSISTENT_WINDOW: IdleWindow = {
  idleMs:     Number.POSITIVE_INFINITY,
  absoluteMs: 365 * 24 * 60 * 60 * 1000,
};

/** Resolve the effective idle/absolute window given device + staff policy. */
export function resolveSessionWindow(kind: DeviceKind, policy: SessionPolicy): IdleWindow {
  if (policy === 'persistent') return PERSISTENT_WINDOW;
  if (policy === 'extended' && kind === 'personal') return EXTENDED_PERSONAL;
  return IDLE_WINDOWS[kind];
}

/** @deprecated prefer cookieMaxAgeForSession(session) so policy is honored. */
export function getCookieMaxAgeSeconds(kind: DeviceKind): number {
  return Math.floor(IDLE_WINDOWS[kind].absoluteMs / 1000);
}

/** Cookie max-age for a freshly-created/loaded session row. */
export function cookieMaxAgeForSession(session: { expiresAt: Date }): number {
  return Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
}

function newSid(): string {
  return randomBytes(32).toString('hex');
}

export interface CreateSessionOpts {
  staffId: number;
  deviceKind: DeviceKind;
  deviceLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Optional hard expiry. When set, overrides the device-kind absolute
   * window — used to tie session lifetime to the end of the staff's shift
   * so they get auto-signed-out when their shift ends.
   */
  expiresAt?: Date;
}

interface SessionDbRow {
  sid: string; staff_id: number; organization_id: string;
  device_kind: DeviceKind; device_label: string | null;
  ip: string | null; user_agent: string | null;
  created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
}

export async function createSession(opts: CreateSessionOpts): Promise<SessionRow> {
  const sid = newSid();

  // Read the staff's current session policy so we apply the right window.
  const policyR = await pool.query(
    `SELECT COALESCE(session_policy, 'default') AS policy FROM staff WHERE id = $1`,
    [opts.staffId],
  );
  const policy = ((policyR.rows[0]?.policy ?? 'default') as SessionPolicy);
  const window = resolveSessionWindow(opts.deviceKind, policy);

  const defaultExpiresAt = new Date(Date.now() + window.absoluteMs);
  // Shift-bound expiry wins (if it's sooner). Falls back to the device's
  // absolute window when no shift is provided.
  const expiresAt = opts.expiresAt && opts.expiresAt.getTime() > Date.now()
    ? new Date(Math.min(opts.expiresAt.getTime(), defaultExpiresAt.getTime()))
    : defaultExpiresAt;

  // staff_sessions.organization_id is derived from staff.organization_id at
  // insert time so the session inherits the tenant the staff currently
  // belongs to. When org-switching lands this will become a parameter.
  const r = await pool.query(
    `INSERT INTO staff_sessions (sid, staff_id, organization_id, device_kind, device_label, ip, user_agent, expires_at)
     SELECT $1, $2, st.organization_id, $3, $4, $5::inet, $6, $7
       FROM staff st
      WHERE st.id = $2
     RETURNING sid, staff_id, organization_id, device_kind, device_label, ip::text AS ip, user_agent,
               created_at, last_seen_at, expires_at, revoked_at`,
    [sid, opts.staffId, opts.deviceKind, opts.deviceLabel ?? null, opts.ip ?? null, opts.userAgent ?? null, expiresAt],
  );
  const row = r.rows[0] as SessionDbRow | undefined;
  if (!row) {
    throw new Error(`createSession: staff ${opts.staffId} not found`);
  }
  return {
    sid: row.sid,
    staffId: row.staff_id,
    organizationId: row.organization_id,
    deviceKind: row.device_kind,
    deviceLabel: row.device_label,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Load a session by sid. Returns null if missing, revoked, expired, or idle
 * past its device's window. On a successful load, also touches last_seen_at.
 *
 * Keep this hot path lean — middleware calls it on every request.
 */
export async function loadSession(sid: string | null | undefined): Promise<SessionRow | null> {
  if (!sid || typeof sid !== 'string' || sid.length < 32) return null;

  const r = await pool.query(
    `SELECT s.sid, s.staff_id, s.organization_id, s.device_kind, s.device_label,
            s.ip::text AS ip, s.user_agent,
            s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            COALESCE(st.session_policy, 'default') AS session_policy
       FROM staff_sessions s
       LEFT JOIN staff st ON st.id = s.staff_id
      WHERE s.sid = $1
      LIMIT 1`,
    [sid],
  );
  const row = r.rows[0] as (SessionDbRow & { session_policy: SessionPolicy }) | undefined;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;

  const window = resolveSessionWindow(row.device_kind as DeviceKind, row.session_policy);
  const idleFor = Date.now() - row.last_seen_at.getTime();
  if (Number.isFinite(window.idleMs) && idleFor > window.idleMs) {
    // Auto-revoke on idle so the row reflects the truth.
    await pool.query(`UPDATE staff_sessions SET revoked_at = NOW() WHERE sid = $1`, [sid]);
    return null;
  }

  return {
    sid: row.sid,
    staffId: row.staff_id,
    organizationId: row.organization_id,
    deviceKind: row.device_kind,
    deviceLabel: row.device_label,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Diagnostic variant of loadSession — returns the same row plus a `reason`
 * tag explaining why a null was produced. Used by /api/auth/session to
 * surface a `x-auth-debug` header so we can tell at a glance whether a
 * sign-out was caused by missing cookie, idle timeout, revocation, etc.
 *
 * Side-effect parity: still auto-revokes on idle, exactly like loadSession.
 */
export type SessionNullReason =
  | 'no-cookie'
  | 'sid-malformed'
  | 'no-row'
  | 'revoked'
  | 'expired'
  | 'idle-timed-out'
  | 'db-error';

export async function loadSessionWithReason(
  sid: string | null | undefined,
): Promise<{ session: SessionRow | null; reason: SessionNullReason | 'ok' }> {
  if (!sid) return { session: null, reason: 'no-cookie' };
  if (typeof sid !== 'string' || sid.length < 32) {
    return { session: null, reason: 'sid-malformed' };
  }

  let r;
  try {
    r = await pool.query(
      `SELECT s.sid, s.staff_id, s.organization_id, s.device_kind, s.device_label,
              s.ip::text AS ip, s.user_agent,
              s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
              COALESCE(st.session_policy, 'default') AS session_policy
         FROM staff_sessions s
         LEFT JOIN staff st ON st.id = s.staff_id
        WHERE s.sid = $1
        LIMIT 1`,
      [sid],
    );
  } catch {
    return { session: null, reason: 'db-error' };
  }

  const row = r.rows[0] as (SessionDbRow & { session_policy: SessionPolicy }) | undefined;
  if (!row) return { session: null, reason: 'no-row' };
  if (row.revoked_at) return { session: null, reason: 'revoked' };
  if (row.expires_at.getTime() <= Date.now()) return { session: null, reason: 'expired' };

  const window = resolveSessionWindow(row.device_kind as DeviceKind, row.session_policy);
  const idleFor = Date.now() - row.last_seen_at.getTime();
  if (Number.isFinite(window.idleMs) && idleFor > window.idleMs) {
    await pool.query(`UPDATE staff_sessions SET revoked_at = NOW() WHERE sid = $1`, [sid]);
    return { session: null, reason: 'idle-timed-out' };
  }

  return {
    session: {
      sid: row.sid,
      staffId: row.staff_id,
      organizationId: row.organization_id,
      deviceKind: row.device_kind,
      deviceLabel: row.device_label,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    },
    reason: 'ok',
  };
}

/**
 * Bump last_seen_at. Best-effort; failure must not break the request.
 * Called from middleware after a successful loadSession.
 */
export async function touchSession(sid: string): Promise<void> {
  try {
    // For persistent-policy staff, slide expires_at forward so the session
    // never crosses its absolute window as long as they keep using it.
    // Default/extended policies leave expires_at alone — absolute window is
    // a hard ceiling for them.
    const persistentMs = PERSISTENT_WINDOW.absoluteMs;
    await pool.query(
      `UPDATE staff_sessions s
          SET last_seen_at = NOW(),
              expires_at = CASE
                WHEN COALESCE(st.session_policy, 'default') = 'persistent'
                  THEN NOW() + ($2 || ' milliseconds')::INTERVAL
                ELSE s.expires_at
              END
         FROM staff st
        WHERE s.sid = $1
          AND s.revoked_at IS NULL
          AND st.id = s.staff_id`,
      [sid, String(persistentMs)],
    );
  } catch {
    // swallow
  }
}

export async function revokeSession(sid: string): Promise<void> {
  await pool.query(`UPDATE staff_sessions SET revoked_at = NOW() WHERE sid = $1 AND revoked_at IS NULL`, [sid]);
}

export async function revokeAllSessionsForStaff(staffId: number): Promise<number> {
  const r = await pool.query(
    `UPDATE staff_sessions SET revoked_at = NOW() WHERE staff_id = $1 AND revoked_at IS NULL`,
    [staffId],
  );
  return r.rowCount ?? 0;
}

export async function listActiveSessions(staffId: number): Promise<SessionRow[]> {
  const r = await pool.query(
    `SELECT sid, staff_id, organization_id, device_kind, device_label, ip::text AS ip, user_agent,
            created_at, last_seen_at, expires_at, revoked_at
       FROM staff_sessions
      WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_seen_at DESC`,
    [staffId],
  );
  return (r.rows as SessionDbRow[]).map((row) => ({
    sid: row.sid,
    staffId: row.staff_id,
    organizationId: row.organization_id,
    deviceKind: row.device_kind,
    deviceLabel: row.device_label,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}
