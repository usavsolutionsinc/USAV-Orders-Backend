/**
 * Client- AND server-safe permission types and pure helpers.
 *
 * As of Phase 2b, the runtime shape derives from `permission-registry.ts` —
 * one declarative array is the single source of truth. The old parallel
 * static role-permission matrix (`ROLE_PERMISSION_SETS`) is gone; runtime
 * permission resolution always reads `roles.permissions` from the DB.
 *
 * What lives here:
 *   - The `PermissionString` and `StaffRole` union types
 *   - `ALL_PERMISSIONS`, `STEP_UP_PERMISSIONS`, `PERMISSION_CATEGORIES`
 *     (all re-exports from the registry — DO NOT add a parallel list here)
 *   - Admin-key helpers (`isAdminRoleKey`, `rolesIncludeAdmin`)
 *   - Role alias normalization (`canonicalRole`)
 *   - Step-up classifier (`requiresStepUp`)
 *   - Legacy error helpers (`PermissionDeniedError`, `permissionDeniedResponse`)
 *
 * What was deleted (Phase 2b):
 *   - `ROLE_PERMISSION_SETS` / `ROLE_PERMISSIONS_FULL` — the seed matrix that
 *     drifted from the DB and caused the work_orders.view bug
 *   - `permissionsForRole`, `permissionsSetForRole`, `effectivePermissions`,
 *     `permissionSource`, `hasPermissionString`, `hasPermission` — all read
 *     from the static matrix and would have continued to produce stale answers
 *   - `ROLE_PERMISSIONS` (the action-only subset by role)
 *
 * Replacement paths for the deleted helpers:
 *   - server: `effectivePermissionsForStaff(staffId)` from `role-store.ts`
 *   - client: `useAuth().has(perm)` (AuthContext, hydrated from /api/auth/session
 *     which now reads from the DB)
 *   - admin UI: receive the role rows from the relevant API endpoint and
 *     compute against `role.permissions` directly
 */

import {
  PERMISSIONS,
  REGISTRY_ALL_PERMISSIONS,
  REGISTRY_STEP_UP_PERMISSIONS,
  REGISTRY_PERMISSION_CATEGORIES,
  type RegistryPermissionString,
} from './permission-registry';

// ─── Admin key helpers ──────────────────────────────────────────────────────

/**
 * The role key that short-circuits permission checks to "all permissions".
 * Centralized so callers don't pepper the codebase with `=== 'admin'` strings.
 * If the key ever needs to change, update this constant and every short-circuit follows.
 */
export const ADMIN_ROLE_KEY = 'admin' as const;

export function isAdminRoleKey(key: string | null | undefined): boolean {
  return key === ADMIN_ROLE_KEY;
}

export function rolesIncludeAdmin(roles: ReadonlyArray<{ key: string }>): boolean {
  return roles.some((r) => isAdminRoleKey(r.key));
}

// ─── Role types & aliases ───────────────────────────────────────────────────

export type StaffRole =
  | 'packer'
  | 'receiver'
  | 'receiving'        // legacy alias for 'receiver'
  | 'technician'
  | 'sales'
  | 'shipper'
  | 'inventory_manager'
  | 'viewer'
  | 'readonly'         // legacy alias for 'viewer'
  | 'admin'
  | 'unknown';

const ROLE_ALIASES: Record<string, StaffRole> = {
  receiving: 'receiver',
  readonly:  'viewer',
};

export const ALL_ROLES: ReadonlyArray<Exclude<StaffRole, 'unknown' | 'receiving' | 'readonly'>> = [
  'admin', 'receiver', 'packer', 'technician', 'shipper', 'inventory_manager', 'sales', 'viewer',
];

type CanonicalRole = Exclude<StaffRole, 'unknown' | 'receiving' | 'readonly'>;

export function canonicalRole(role: StaffRole): CanonicalRole | 'unknown' {
  if (role === 'unknown') return 'unknown';
  const aliased = ROLE_ALIASES[role];
  return (aliased ?? role) as CanonicalRole;
}

// ─── Permission types & runtime sets (all derived from the registry) ───────

export type PermissionString = RegistryPermissionString;

/** Backwards-compat: a small subset of "action" permissions that some legacy
 * code passes around as a distinct narrower type. Kept as a string literal
 * union so callers don't need a runtime check. */
export type PermissionAction =
  | 'bin.adjust'
  | 'bin.set'
  | 'bin.rename'
  | 'bin.swap'
  | 'bin.remove'
  | 'bin.add_sku'
  | 'cycle_count.approve';

export const ALL_PERMISSIONS: ReadonlySet<PermissionString> = REGISTRY_ALL_PERMISSIONS;
export const STEP_UP_PERMISSIONS: ReadonlySet<PermissionString> = REGISTRY_STEP_UP_PERMISSIONS;
export const PERMISSION_CATEGORIES = REGISTRY_PERMISSION_CATEGORIES;

export function requiresStepUp(perm: PermissionString): boolean {
  return STEP_UP_PERMISSIONS.has(perm);
}

/**
 * Where does a permission's current "effective" state come from, for the
 * admin UI's badge column? Computation is now done at the call site against
 * the DB-sourced role permission set (see StaffAccessDetail.tsx).
 */
export type PermissionSource = 'role' | 'granted' | 'revoked' | 'role-denies';

// ─── Pure helpers (DB-backed callers should use role-store.ts instead) ─────

/**
 * Union the `permissions` arrays from a list of roles into a typed Set,
 * silently dropping any strings that aren't valid PermissionString values.
 *
 * Used by `computeEffectivePermissions` below and the admin UI.
 */
export function unionRolePermissions(
  roles: ReadonlyArray<{ permissions: ReadonlyArray<string> }>,
): Set<PermissionString> {
  const out = new Set<PermissionString>();
  for (const r of roles) {
    for (const p of r.permissions) {
      if (ALL_PERMISSIONS.has(p as PermissionString)) out.add(p as PermissionString);
    }
  }
  return out;
}

/**
 * The full effective-permission computation. Single pure source of truth used
 * by both server-side resolvers (current-user.ts, role-store.ts) and any UI
 * that wants to simulate "what would this staff have access to?"
 *
 * Merge order:
 *   1. If any role has key 'admin' → ALL_PERMISSIONS (admin short-circuit)
 *   2. Otherwise: union of all role permission arrays
 *   3. ∪ permissions_added (per-staff override grants), filtered to known
 *   4. \ permissions_removed (per-staff override revokes)
 *
 * Unknown permission strings are silently dropped — they're not in the
 * runtime registry and can't be evaluated. (Writes are rejected loudly at
 * the admin endpoints, so unknowns shouldn't accumulate.)
 */
export function computeEffectivePermissions(
  roles: ReadonlyArray<{ key: string; permissions: ReadonlyArray<string> }>,
  added: ReadonlyArray<string> = [],
  removed: ReadonlyArray<string> = [],
): Set<PermissionString> {
  if (rolesIncludeAdmin(roles)) {
    return new Set(ALL_PERMISSIONS);
  }
  const set = unionRolePermissions(roles);
  for (const p of added) {
    if (ALL_PERMISSIONS.has(p as PermissionString)) set.add(p as PermissionString);
  }
  for (const p of removed) {
    set.delete(p as PermissionString);
  }
  return set;
}

// ─── Legacy error helpers (still used by several route handlers) ───────────

export class PermissionDeniedError extends Error {
  constructor(
    public readonly action: PermissionAction,
    public readonly role: StaffRole,
    public readonly staffId: number | null,
  ) {
    super(`Role "${role}" cannot perform "${action}"`);
    this.name = 'PermissionDeniedError';
  }
}

export function permissionDeniedResponse(err: PermissionDeniedError) {
  return {
    error: 'FORBIDDEN',
    action: err.action,
    role: err.role,
    message: `Your role (${err.role}) cannot perform this action.`,
  };
}

// ─── Re-export the registry for callers that want richer metadata ──────────

export { PERMISSIONS };
