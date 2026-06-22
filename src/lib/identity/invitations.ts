/**
 * Org invitations — the multi-org on-ramp.
 *
 * An invitation targets an EMAIL (not an existing account) so you can invite
 * people who have no account yet. On accept we: find-or-create the global
 * account, upsert the membership, and create the per-org staff PROFILE — all in
 * one transaction. This is what lights up the Phase 1 switcher: invite the same
 * human's email to a second org and they gain a second membership.
 *
 * Distinct from `staff_enrollments` (src/lib/auth/enrollment.ts), which is the
 * single-org device/PIN enrollment for an already-created staff row. Invitations
 * operate at the account+membership layer and can create the staff row.
 *
 * Token handling: a 24-byte base64url token is emailed; only its sha256 hash is
 * stored (unlike staff_enrollments which stores the raw token).
 *
 * See docs/identity-layer-plan.md.
 */

import { randomBytes, createHash } from 'node:crypto';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { canonicalRole, ALL_ROLES, type StaffRole } from '@/lib/auth/permissions';
import { invalidateStaffRolesCache } from '@/lib/auth/role-store';
import { getAccountByEmail, createAccount } from './accounts';
import { verifyPassword } from './password';
import type { OrgId } from '@/lib/tenancy/constants';

function newToken(): string {
  return randomBytes(24).toString('base64url');
}
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class InvitationError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'EXPIRED'
      | 'ALREADY_ACCEPTED'
      | 'PASSWORD_REQUIRED'
      | 'PASSWORD_MISMATCH'
      | 'INVALID_ROLE',
  ) {
    super(code);
    this.name = 'InvitationError';
  }
}

export interface CreateInvitationInput {
  orgId: OrgId;
  email: string;
  /** Role key for the new member; defaults to 'viewer' when omitted. */
  roleKey?: string | null;
  /** Account id of the inviting admin (nullable). */
  invitedByAccountId?: string | null;
  /** Invitation lifetime in days (default 14). */
  expiresInDays?: number;
}

/** Create an invitation. Returns the id + the RAW token (only its hash is stored). */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ id: string; token: string; roleKey: string }> {
  const canonical = canonicalRole((input.roleKey ?? 'viewer').toLowerCase() as StaffRole);
  if (canonical === 'unknown' || !ALL_ROLES.includes(canonical)) {
    throw new InvitationError('INVALID_ROLE');
  }
  const token = newToken();
  const days = input.expiresInDays ?? 14;
  // Re-inviting the same email refreshes the pending invite (new token, new
  // expiry) rather than stacking duplicates — keyed on the partial unique index
  // uq_org_invitations_pending (org_id, lower(email)) WHERE accepted_at IS NULL.
  const r = await pool.query<{ id: string }>(
    `INSERT INTO org_invitations (org_id, email, role_key, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)
     ON CONFLICT (org_id, lower(email)) WHERE accepted_at IS NULL
     DO UPDATE SET role_key = EXCLUDED.role_key,
                   token_hash = EXCLUDED.token_hash,
                   invited_by = EXCLUDED.invited_by,
                   expires_at = EXCLUDED.expires_at,
                   created_at = now()
     RETURNING id`,
    [input.orgId, input.email, canonical, hashToken(token), input.invitedByAccountId ?? null, String(days)],
  );
  return { id: r.rows[0]!.id, token, roleKey: canonical };
}

export interface PendingInvitation {
  id: string;
  email: string;
  roleKey: string | null;
  createdAt: string;
  expiresAt: string;
}

/** List unaccepted, unexpired invitations for an org. */
export async function listPendingInvitations(orgId: OrgId): Promise<PendingInvitation[]> {
  const r = await pool.query<{
    id: string; email: string; role_key: string | null; created_at: string; expires_at: string;
  }>(
    `SELECT id, email, role_key, created_at, expires_at
       FROM org_invitations
      WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [orgId],
  );
  return r.rows.map((row) => ({
    id: row.id, email: row.email, roleKey: row.role_key,
    createdAt: row.created_at, expiresAt: row.expires_at,
  }));
}

/** Revoke (hard-delete) a pending invitation scoped to its org. */
export async function revokeInvitation(orgId: OrgId, id: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM org_invitations WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL`,
    [id, orgId],
  );
  return (r.rowCount ?? 0) > 0;
}

export type InvitationPreview =
  | { status: 'valid'; orgId: string; orgName: string; email: string; roleKey: string | null; expiresAt: string }
  | { status: 'expired' | 'accepted' | 'not_found' };

/** Resolve invite metadata for the accept page. Does not consume the token. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const r = await pool.query<{
    org_id: string; org_name: string; email: string; role_key: string | null;
    expires_at: string; accepted_at: string | null;
  }>(
    `SELECT i.org_id, o.name AS org_name, i.email, i.role_key, i.expires_at, i.accepted_at
       FROM org_invitations i
       JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = $1
      LIMIT 1`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) return { status: 'not_found' };
  if (row.accepted_at) return { status: 'accepted' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { status: 'expired' };
  return {
    status: 'valid',
    orgId: row.org_id,
    orgName: row.org_name,
    email: row.email,
    roleKey: row.role_key,
    expiresAt: row.expires_at,
  };
}

export interface AcceptResult {
  accountId: string;
  staffId: number;
  orgId: string;
}

/**
 * Accept an invitation. Atomically (within the target org's tenant transaction):
 *   1. Claim the invite (accepted_at), failing on a double-accept race.
 *   2. Find-or-create the global account by email (new accounts require a password).
 *   3. Upsert an active membership.
 *   4. Create the per-org staff profile + role assignment (or reuse an existing one).
 *
 * `name`/`password` are used only when creating a NEW account; an existing
 * account keeps its own credentials and simply gains the membership.
 */
export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<AcceptResult> {
  const tokenHash = hashToken(input.token);

  // Pre-flight (outside tx) to learn the org + validate, then do the atomic work.
  const head = await pool.query<{
    id: string; org_id: string; email: string; role_key: string | null;
    expires_at: string; accepted_at: string | null;
  }>(
    `SELECT id, org_id, email, role_key, expires_at, accepted_at
       FROM org_invitations WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  );
  const invite = head.rows[0];
  if (!invite) throw new InvitationError('NOT_FOUND');
  if (invite.accepted_at) throw new InvitationError('ALREADY_ACCEPTED');
  if (new Date(invite.expires_at).getTime() <= Date.now()) throw new InvitationError('EXPIRED');

  const canonical = canonicalRole((invite.role_key ?? 'viewer').toLowerCase() as StaffRole);
  if (canonical === 'unknown' || !ALL_ROLES.includes(canonical)) throw new InvitationError('INVALID_ROLE');

  const result = await withTenantTransaction(invite.org_id as OrgId, async (client) => {
    // 1. Claim — fails if someone else accepted between the pre-flight and now.
    const claim = await client.query(
      `UPDATE org_invitations SET accepted_at = now()
        WHERE id = $1 AND accepted_at IS NULL
        RETURNING id`,
      [invite.id],
    );
    if ((claim.rowCount ?? 0) === 0) throw new InvitationError('ALREADY_ACCEPTED');

    // Serialize concurrent accepts for the same email so two requests can't both
    // pass the find-then-create check and orphan an account. Transaction-scoped;
    // released on commit/rollback.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('identity:account_email'), hashtext(lower($1)))`,
      [invite.email],
    );

    // 2. Find-or-create the global account by the invited email.
    const existing = await getAccountByEmail(invite.email, client);
    let accountId: string;
    if (existing) {
      // The email already has an account. Possession of the invite link is NOT
      // proof of ownership of that account, so require its password before we
      // attach the membership and mint a session as it. (New accounts set their
      // password here instead.)
      const ok = await verifyPassword(input.password, existing.passwordHash);
      if (!ok) throw new InvitationError('PASSWORD_MISMATCH');
      accountId = existing.id;
    } else {
      if (!input.password) throw new InvitationError('PASSWORD_REQUIRED');
      accountId = await createAccount(
        { displayName: input.name, email: invite.email, password: input.password },
        client,
      );
    }

    // 3. Upsert the membership.
    const mem = await client.query<{ id: string }>(
      `INSERT INTO memberships (account_id, org_id, status, joined_at)
       VALUES ($1, $2, 'active', now())
       ON CONFLICT (account_id, org_id)
       DO UPDATE SET status = 'active', joined_at = COALESCE(memberships.joined_at, now())
       RETURNING id`,
      [accountId, invite.org_id],
    );
    const membershipId = mem.rows[0]!.id;

    // 4. Reuse an existing profile for this membership, else create one.
    const existingStaff = await client.query<{ id: number }>(
      `SELECT id FROM staff WHERE membership_id = $1 LIMIT 1`,
      [membershipId],
    );
    let staffId: number;
    if (existingStaff.rows[0]) {
      staffId = existingStaff.rows[0].id;
    } else {
      const staffRes = await client.query<{ id: number }>(
        `INSERT INTO staff (name, role, organization_id, active, status, default_home_path, account_id, membership_id)
         VALUES ($1, $2, $3, true, 'active', '/dashboard', $4, $5)
         RETURNING id`,
        [input.name, canonical, invite.org_id, accountId, membershipId],
      );
      staffId = staffRes.rows[0]!.id;
      await client.query(
        `INSERT INTO staff_roles (staff_id, role_id, granted_at)
         SELECT $1, r.id, NOW() FROM roles r WHERE r.key = $2
         ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [staffId, canonical],
      );
    }

    return { accountId, staffId, orgId: invite.org_id };
  });

  invalidateStaffRolesCache(result.staffId);
  return result;
}
