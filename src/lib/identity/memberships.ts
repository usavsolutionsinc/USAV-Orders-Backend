/**
 * Identity-layer data access: resolving an account's org memberships and the
 * switch target for org-switching.
 *
 * EVERY function here is BEST-EFFORT and must NEVER throw — these run inside the
 * hot session-hydration path (/api/auth/session, server-session) which executes
 * on every page load. Before 2026-06-20e_identity_layer_phase1.sql is applied,
 * the accounts/memberships tables and staff.account_id column do not exist;
 * queries against them throw "relation/column does not exist". We swallow those
 * and fall back to a single synthesized membership for the current org, so the
 * UI is correct both before and after the migration.
 *
 * See docs/identity-layer-plan.md.
 */

import pool from '@/lib/db';
import type { OrgMembership } from './types';

/** Resolve the global account id for a per-org staff profile. null on any error
 *  (including the column not existing pre-migration). */
export async function resolveAccountIdForStaff(staffId: number): Promise<string | null> {
  try {
    const r = await pool.query<{ account_id: string | null }>(
      `SELECT account_id FROM staff WHERE id = $1 LIMIT 1`,
      [staffId],
    );
    return r.rows[0]?.account_id ?? null;
  } catch {
    return null;
  }
}

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string | null;
  plan: string | null;
  staff_id: number;
  role: string | null;
}

/**
 * All active memberships for an account, across orgs. Joins the membership →
 * organization → the staff profile in that org. Returns [] on any error.
 */
export async function listMembershipsForAccount(accountId: string): Promise<MembershipRow[]> {
  try {
    const r = await pool.query<MembershipRow>(
      `SELECT o.id   AS organization_id,
              o.name AS organization_name,
              o.slug AS organization_slug,
              o.plan AS plan,
              s.id   AS staff_id,
              s.role AS role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         -- the profile row for this account in this org
         LEFT JOIN staff s ON s.membership_id = m.id
        WHERE m.account_id = $1
          AND m.status = 'active'
          AND o.deleted_at IS NULL
        ORDER BY o.name ASC`,
      [accountId],
    );
    // Drop memberships with no resolvable profile row (can't switch into them).
    return r.rows.filter((row) => row.staff_id != null);
  } catch {
    return [];
  }
}

/**
 * Build the membership list for the auth envelope. ALWAYS returns at least one
 * entry (the current org), even pre-migration, so the client never sees an
 * empty workspace list. Never throws.
 */
export async function resolveEnvelopeMemberships(input: {
  staffId: number;
  currentOrgId: string;
  currentOrgName: string;
  currentOrgSlug: string | null;
  currentOrgPlan: string | null;
}): Promise<OrgMembership[]> {
  const fallback: OrgMembership[] = [{
    organizationId: input.currentOrgId,
    organizationName: input.currentOrgName,
    organizationSlug: input.currentOrgSlug,
    plan: input.currentOrgPlan,
    staffId: input.staffId,
    role: null,
    isCurrent: true,
  }];

  try {
    const accountId = await resolveAccountIdForStaff(input.staffId);
    if (!accountId) return fallback;

    const rows = await listMembershipsForAccount(accountId);
    if (rows.length === 0) return fallback;

    return rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationSlug: row.organization_slug,
      plan: row.plan,
      staffId: row.staff_id,
      role: row.role,
      isCurrent: row.organization_id === input.currentOrgId,
    }));
  } catch {
    return fallback;
  }
}

/**
 * Find the staff profile this account should assume when switching INTO an org.
 * Returns null if the account has no active membership there — which is the
 * authorization gate for /api/auth/switch-org. Throws only on genuine DB
 * failure (caller maps to 500); a missing table pre-migration returns null.
 */
export async function findSwitchTarget(
  accountId: string,
  orgId: string,
): Promise<{ staffId: number } | null> {
  try {
    const r = await pool.query<{ staff_id: number }>(
      `SELECT s.id AS staff_id
         FROM memberships m
         JOIN staff s ON s.membership_id = m.id
        WHERE m.account_id = $1
          AND m.org_id = $2
          AND m.status = 'active'
        LIMIT 1`,
      [accountId, orgId],
    );
    const staffId = r.rows[0]?.staff_id;
    return staffId != null ? { staffId } : null;
  } catch {
    return null;
  }
}

/** Best-effort auth audit write. Never throws. */
export async function logAuthEvent(input: {
  accountId: string | null;
  orgId: string | null;
  event: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth_events (account_id, org_id, event, ip, user_agent)
       VALUES ($1, $2, $3, $4::inet, $5)`,
      [input.accountId, input.orgId, input.event, input.ip ?? null, input.userAgent ?? null],
    );
  } catch {
    /* swallow — audit must never block auth */
  }
}
