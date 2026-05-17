/**
 * Server-side opaque sessions in Postgres. Cookie carries only a 32-byte
 * random sid; everything else (staff_id, role, device, expiry, revocation)
 * lives in `staff_sessions`. That means we can revoke a single device or
 * an entire user's sessions instantly — something a JWT can't do without a
 * blocklist.
 *
 * Idle-timeout policy by device_kind:
 *   station  →  8 hr idle, 24 hr absolute  (workstation default, survives a coffee break + lunch)
 *   personal → 12 hr idle, 30 days absolute (the "Remember me" device — long-lived)
 *   phone    →  4 hr idle,  4 hr absolute  (matches Ably token TTL)
 */

import { randomBytes } from 'node:crypto';
import pool from '@/lib/db';

export const SESSION_COOKIE_NAME = 'usav_sid';

export type DeviceKind = 'station' | 'personal' | 'phone';

export interface SessionRow {
  sid: string;
  staffId: number;
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

export function getCookieMaxAgeSeconds(kind: DeviceKind): number {
  return Math.floor(IDLE_WINDOWS[kind].absoluteMs / 1000);
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
}

interface SessionDbRow {
  sid: string; staff_id: number; device_kind: DeviceKind; device_label: string | null;
  ip: string | null; user_agent: string | null;
  created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
}

export async function createSession(opts: CreateSessionOpts): Promise<SessionRow> {
  const sid = newSid();
  const window = IDLE_WINDOWS[opts.deviceKind];
  const expiresAt = new Date(Date.now() + window.absoluteMs);

  const r = await pool.query(
    `INSERT INTO staff_sessions (sid, staff_id, device_kind, device_label, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5::inet, $6, $7)
     RETURNING sid, staff_id, device_kind, device_label, ip::text AS ip, user_agent,
               created_at, last_seen_at, expires_at, revoked_at`,
    [sid, opts.staffId, opts.deviceKind, opts.deviceLabel ?? null, opts.ip ?? null, opts.userAgent ?? null, expiresAt],
  );
  const row = r.rows[0] as SessionDbRow;
  return {
    sid: row.sid,
    staffId: row.staff_id,
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
    `SELECT sid, staff_id, device_kind, device_label, ip::text AS ip, user_agent,
            created_at, last_seen_at, expires_at, revoked_at
       FROM staff_sessions
      WHERE sid = $1
      LIMIT 1`,
    [sid],
  );
  const row = r.rows[0] as SessionDbRow | undefined;
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;

  const window = IDLE_WINDOWS[row.device_kind as DeviceKind];
  const idleFor = Date.now() - row.last_seen_at.getTime();
  if (idleFor > window.idleMs) {
    // Auto-revoke on idle so the row reflects the truth.
    await pool.query(`UPDATE staff_sessions SET revoked_at = NOW() WHERE sid = $1`, [sid]);
    return null;
  }

  return {
    sid: row.sid,
    staffId: row.staff_id,
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
      `SELECT sid, staff_id, device_kind, device_label, ip::text AS ip, user_agent,
              created_at, last_seen_at, expires_at, revoked_at
         FROM staff_sessions
        WHERE sid = $1
        LIMIT 1`,
      [sid],
    );
  } catch {
    return { session: null, reason: 'db-error' };
  }

  const row = r.rows[0] as SessionDbRow | undefined;
  if (!row) return { session: null, reason: 'no-row' };
  if (row.revoked_at) return { session: null, reason: 'revoked' };
  if (row.expires_at.getTime() <= Date.now()) return { session: null, reason: 'expired' };

  const window = IDLE_WINDOWS[row.device_kind as DeviceKind];
  const idleFor = Date.now() - row.last_seen_at.getTime();
  if (idleFor > window.idleMs) {
    await pool.query(`UPDATE staff_sessions SET revoked_at = NOW() WHERE sid = $1`, [sid]);
    return { session: null, reason: 'idle-timed-out' };
  }

  return {
    session: {
      sid: row.sid,
      staffId: row.staff_id,
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
    await pool.query(`UPDATE staff_sessions SET last_seen_at = NOW() WHERE sid = $1 AND revoked_at IS NULL`, [sid]);
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
    `SELECT sid, staff_id, device_kind, device_label, ip::text AS ip, user_agent,
            created_at, last_seen_at, expires_at, revoked_at
       FROM staff_sessions
      WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_seen_at DESC`,
    [staffId],
  );
  return (r.rows as SessionDbRow[]).map((row) => ({
    sid: row.sid,
    staffId: row.staff_id,
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
