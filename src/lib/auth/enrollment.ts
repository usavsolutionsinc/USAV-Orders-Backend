/**
 * One-time enrollment tokens. An admin generates one for a new staff row;
 * the staff opens it on their phone (via QR), sets a PIN, optionally
 * registers a passkey. Token is single-use and time-limited (24h default).
 */

import { randomBytes } from 'node:crypto';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

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

export async function createEnrollment(
  opts: CreateEnrollmentOpts,
  orgId?: OrgId,
): Promise<EnrollmentToken> {
  const token = newToken();
  const ttlHours = opts.ttlHours ?? DEFAULT_TTL_HOURS;
  // `staff_enrollments` has no organization_id of its own — it is child-scoped
  // via staff_id → staff. When an admin context supplies orgId, gate the INSERT
  // on the staff PARENT's org so an admin cannot mint an enrollment for a staff
  // row in another org: the INSERT…SELECT only produces a row when the target
  // staff belongs to this org. (No org → byte-identical legacy path for the
  // sign-in/transitional callers.)
  const r = orgId
    ? await tenantQuery<EnrollmentDbRow>(
        orgId,
        `INSERT INTO staff_enrollments (token, staff_id, created_by, expires_at)
         SELECT $1, s.id, $3, NOW() + ($4 || ' hours')::INTERVAL
           FROM staff s
          WHERE s.id = $2 AND s.organization_id = $5
         RETURNING token, staff_id, created_by, expires_at, consumed_at, created_at`,
        [token, opts.staffId, opts.createdBy ?? null, String(ttlHours), orgId],
      )
    : await pool.query(
        `INSERT INTO staff_enrollments (token, staff_id, created_by, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)
         RETURNING token, staff_id, created_by, expires_at, consumed_at, created_at`,
        [token, opts.staffId, opts.createdBy ?? null, String(ttlHours)],
      );
  const row = r.rows[0] as EnrollmentDbRow | undefined;
  if (!row) {
    // Org-gated path: target staff is not in this org (cross-tenant attempt) or
    // does not exist → surface as not-found rather than silently succeeding.
    throw new Error('createEnrollment: staff not found in organization');
  }
  return {
    token: row.token,
    staffId: row.staff_id,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export async function loadEnrollment(token: string, orgId?: OrgId): Promise<EnrollmentToken | null> {
  if (!token || token.length < 16) return null;
  // No own organization_id column → org-scope via the staff parent. When orgId
  // is supplied, a token whose staff lives in another org reads as not-found.
  // Sign-in callers omit orgId and keep the byte-identical legacy lookup.
  const r = orgId
    ? await tenantQuery<EnrollmentDbRow>(
        orgId,
        `SELECT e.token, e.staff_id, e.created_by, e.expires_at, e.consumed_at, e.created_at
           FROM staff_enrollments e
           JOIN staff s ON s.id = e.staff_id
          WHERE e.token = $1 AND s.organization_id = $2
          LIMIT 1`,
        [token, orgId],
      )
    : await pool.query(
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
export async function consumeEnrollment(token: string, orgId?: OrgId): Promise<EnrollmentToken | null> {
  // No own organization_id column → gate the mutation on the staff parent's org
  // via a correlated EXISTS. A token belonging to another org's staff is left
  // untouched and reads as not-found. Sign-in callers omit orgId → byte-identical.
  const r = orgId
    ? await tenantQuery<EnrollmentDbRow>(
        orgId,
        `UPDATE staff_enrollments e
            SET consumed_at = NOW()
          WHERE e.token = $1
            AND e.consumed_at IS NULL
            AND e.expires_at > NOW()
            AND EXISTS (
              SELECT 1 FROM staff s
               WHERE s.id = e.staff_id AND s.organization_id = $2
            )
          RETURNING e.token, e.staff_id, e.created_by, e.expires_at, e.consumed_at, e.created_at`,
        [token, orgId],
      )
    : await pool.query(
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
