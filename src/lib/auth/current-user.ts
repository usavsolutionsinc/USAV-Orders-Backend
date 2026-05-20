/**
 * Server-side helpers to resolve the current authenticated staff from the
 * `usav_sid` cookie. Used by route handlers, server actions, and the
 * `requirePermission` page guard.
 *
 * Phase 2 of the editable-roles work: the effective permission set is now
 * computed from the DB (`staff_roles` × `roles`) rather than the static
 * matrix in code. The static matrix at `permissions-shared.ts` stays as
 * the seed source and offline fallback.
 *
 * Merge order (mirrors Discord):
 *   1. UNION of every role's permissions assigned to this staff
 *   2. ∪ permissions_added (per-staff override grants)
 *   3. \ permissions_removed (per-staff override revokes)
 *   4. If any assigned role has key 'admin' → short-circuit to ALL.
 */

import { cookies } from 'next/headers';
import pool from '@/lib/db';
import { loadSession, SESSION_COOKIE_NAME, type SessionRow } from './session';
import { computeEffectivePermissions, type PermissionString, type StaffRole } from './permissions-shared';
import { loadRolesForStaff, type RoleRow } from './role-store';

export interface CurrentUser {
  session: SessionRow;
  staffId: number;
  /** Active tenant for this request — propagated from staff_sessions. */
  organizationId: string;
  /** Primary role key (lowest-position assigned role, or the staff.role column if none). */
  role: StaffRole;
  /** Every role assigned to this staff, ordered by position ascending. */
  roles: ReadonlyArray<RoleRow>;
  permissions: Set<PermissionString>;
  permissionsAdded: ReadonlyArray<string>;
  permissionsRemoved: ReadonlyArray<string>;
}

interface StaffOverrideRow {
  role: string | null;
  permissions_added: string[] | null;
  permissions_removed: string[] | null;
}

async function loadStaffOverrides(staffId: number): Promise<StaffOverrideRow | null> {
  try {
    const r = await pool.query(
      `SELECT role, permissions_added, permissions_removed
         FROM staff
        WHERE id = $1
        LIMIT 1`,
      [staffId],
    );
    return (r.rows[0] as StaffOverrideRow | undefined) ?? null;
  } catch {
    return null;
  }
}

function normalizeRoleKey(raw: string | null | undefined): StaffRole {
  const v = (raw ?? '').trim().toLowerCase();
  const known: ReadonlyArray<StaffRole> = [
    'packer', 'receiver', 'receiving', 'technician', 'sales',
    'shipper', 'inventory_manager', 'viewer', 'readonly', 'admin',
  ];
  return (known as ReadonlyArray<string>).includes(v) ? (v as StaffRole) : 'unknown';
}

function mergePermissions(
  roles: ReadonlyArray<RoleRow>,
  added: ReadonlyArray<string>,
  removed: ReadonlyArray<string>,
): Set<PermissionString> {
  // Single pure resolver lives in permissions-shared.ts so the admin UI,
  // server resolvers, and unit tests all agree on the merge order.
  return computeEffectivePermissions(roles, added, removed);
}

async function buildCurrentUser(session: SessionRow | null): Promise<CurrentUser | null> {
  if (!session) return null;
  const [overrides, roles] = await Promise.all([
    loadStaffOverrides(session.staffId),
    loadRolesForStaff(session.staffId),
  ]);
  // Primary role: first row from loadRolesForStaff (already position-ordered).
  // Falls back to the staff.role column if no assignments exist. Falls back
  // to 'unknown' if neither.
  const primary = roles[0]?.key ?? overrides?.role ?? null;
  const role = normalizeRoleKey(primary);
  const added = overrides?.permissions_added ?? [];
  const removed = overrides?.permissions_removed ?? [];

  return {
    session,
    staffId: session.staffId,
    organizationId: session.organizationId,
    role,
    roles,
    permissions: mergePermissions(roles, added, removed),
    permissionsAdded: added,
    permissionsRemoved: removed,
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = await loadSession(sid);
  return buildCurrentUser(session);
}

export async function getCurrentUserBySid(sid: string | null | undefined): Promise<CurrentUser | null> {
  const session = await loadSession(sid);
  return buildCurrentUser(session);
}
