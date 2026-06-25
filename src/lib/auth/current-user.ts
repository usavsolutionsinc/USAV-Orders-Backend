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
import {
  resolveMobileDisplayConfig,
  type MobileDisplayConfig,
} from './mobile-display-config';

export interface CurrentUser {
  session: SessionRow;
  staffId: number;
  name: string;
  /** Active tenant for this request — propagated from staff_sessions. */
  organizationId: string;
  /** Primary role key (lowest-position assigned role, or the staff.role column if none). */
  role: StaffRole;
  /** Every role assigned to this staff, ordered by position ascending. */
  roles: ReadonlyArray<RoleRow>;
  permissions: Set<PermissionString>;
  permissionsAdded: ReadonlyArray<string>;
  permissionsRemoved: ReadonlyArray<string>;
  /** Resolved mobile UI config (role defaults + per-staff override). */
  mobileDisplayConfig: MobileDisplayConfig;
}

interface StaffOverrideRow {
  name: string | null;
  role: string | null;
  permissions_added: string[] | null;
  permissions_removed: string[] | null;
  mobile_display_config: unknown;
}

async function loadStaffOverrides(staffId: number): Promise<StaffOverrideRow | null> {
  try {
    const r = await pool.query(
      `SELECT name, role, permissions_added, permissions_removed, mobile_display_config
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

  const mobileDisplayConfig = resolveMobileDisplayConfig({
    roles: roles.map((r) => ({ key: r.key, mobile_defaults: r.mobileDefaults })),
    staffOverride: overrides?.mobile_display_config ?? null,
  });

  return {
    session,
    staffId: session.staffId,
    // `??` alone lets an empty-string `staff.name` (or a failed override load)
    // reach the client as '', which renders as a bare dot avatar + "Staff #id"
    // everywhere. Coalesce blank/whitespace to a stable `Staff #id` so the
    // session envelope is always a usable display name — the single source of
    // truth read synchronously by every surface (no per-surface name fetch).
    name: overrides?.name?.trim() || `Staff #${session.staffId}`,
    organizationId: session.organizationId,
    role,
    roles,
    permissions: mergePermissions(roles, added, removed),
    permissionsAdded: added,
    permissionsRemoved: removed,
    mobileDisplayConfig,
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
