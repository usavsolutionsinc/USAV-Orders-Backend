/**
 * One-time enrollment tokens. An admin generates one for a new staff row;
 * the staff opens it on their phone (via QR), sets a PIN, optionally
 * registers a passkey. Token is single-use and time-limited (24h default).
 */

import { randomBytes } from 'node:crypto';
import pool from '@/lib/db';

const DEFAULT_TTL_HOURS = 24;

interface EnrollmentDbRow {
  token: string;
  staff_id: number;
  created_by: number | null;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export interface EnrollmentToken {
  token: string;
  staffId: number;
  createdBy: number | null;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

function newToken(): string {
  // 24-byte url-safe; matches URL path use without further encoding.
  return randomBytes(24).toString('base64url');
}

export interface CreateEnrollmentOpts {
  staffId: number;
  createdBy?: number | null;
  ttlHours?: number;
}

export async function createEnrollment(opts: CreateEnrollmentOpts): Promise<EnrollmentToken> {
  const token = newToken();
  const ttlHours = opts.ttlHours ?? DEFAULT_TTL_HOURS;
  const r = await pool.query(
    `INSERT INTO staff_enrollments (token, staff_id, created_by, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)
     RETURNING token, staff_id, created_by, expires_at, consumed_at, created_at`,
    [token, opts.staffId, opts.createdBy ?? null, String(ttlHours)],
  );
  const row = r.rows[0] as EnrollmentDbRow;
  return {
    token: row.token,
    staffId: row.staff_id,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export async function loadEnrollment(token: string): Promise<EnrollmentToken | null> {
  if (!token || token.length < 16) return null;
  const r = await pool.query(
    `SELECT token, staff_id, created_by, expires_at, consumed_at, created_at
       FROM staff_enrollments
      WHERE token = $1
      LIMIT 1`,
    [token],
  );
  const row = r.rows[0] as EnrollmentDbRow | undefined;
  if (!row) return null;
  if (row.consumed_at) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;
  return {
    token: row.token,
    staffId: row.staff_id,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

/**
 * Atomically consume the token. Returns the matching row only if it was
 * unconsumed and unexpired at the moment of the call — race-safe.
 */
export async function consumeEnrollment(token: string): Promise<EnrollmentToken | null> {
  const r = await pool.query(
    `UPDATE staff_enrollments
        SET consumed_at = NOW()
      WHERE token = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING token, staff_id, created_by, expires_at, consumed_at, created_at`,
    [token],
  );
  const row = r.rows[0] as EnrollmentDbRow | undefined;
  if (!row) return null;
  return {
    token: row.token,
    staffId: row.staff_id,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}
