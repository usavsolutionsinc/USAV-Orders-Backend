/**
 * Server-only in-process cache for the DB-defined `roles` table and
 * `staff_roles` assignments. Hot-path readers (current-user.ts, withAuth)
 * go through here instead of hitting the DB on every request.
 *
 * Cache invalidation is event-driven: the admin endpoints that mutate roles
 * or assignments call `invalidateRoleCache()` / `invalidateStaffRolesCache(id)`
 * after the write. A 60-second wall-clock TTL also expires entries naturally
 * so a missed invalidation can't strand the cluster on stale data.
 *
 * Why a Map and not react-cache or unstable_cache: this module is imported
 * by Node-only route handlers and by getCurrentUser(); we don't want
 * Next's request-scoped caching here — we want process-wide.
 */

import pool from '@/lib/db';
import { computeEffectivePermissions, type PermissionString } from './permissions-shared';

export interface RoleRow {
  id: number;
  key: string;
  label: string;
  color: string;
  position: number;
  permissions: ReadonlyArray<string>;
  isSystem: boolean;
}

const ROLE_TTL_MS = 60_000;

interface RolesSnapshot {
  byId: Map<number, RoleRow>;
  byKey: Map<string, RoleRow>;
  orderedByPosition: RoleRow[];
  expiresAt: number;
}

let rolesCache: RolesSnapshot | null = null;
let inflightRoles: Promise<RolesSnapshot> | null = null;

/**
 * Load and cache the entire `roles` table. Single SELECT — the table is
 * tiny (<100 rows typical), so we never page.
 */
async function fetchRoles(): Promise<RolesSnapshot> {
  const r = await pool.query(
    `SELECT id, key, label, color, position, permissions, is_system
       FROM roles
      ORDER BY position ASC, id ASC`,
  );
  const rows: RoleRow[] = (r.rows as Array<{
    id: number; key: string; label: string; color: string;
    position: number; permissions: string[]; is_system: boolean;
  }>).map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    color: row.color,
    position: row.position,
    permissions: row.permissions || [],
    isSystem: row.is_system,
  }));

  const byId = new Map<number, RoleRow>();
  const byKey = new Map<string, RoleRow>();
  for (const role of rows) {
    byId.set(role.id, role);
    byKey.set(role.key, role);
  }
  return { byId, byKey, orderedByPosition: rows, expiresAt: Date.now() + ROLE_TTL_MS };
}

async function getRolesSnapshot(): Promise<RolesSnapshot> {
  const now = Date.now();
  if (rolesCache && rolesCache.expiresAt > now) return rolesCache;
  if (inflightRoles) return inflightRoles;
  inflightRoles = fetchRoles().then((snap) => {
    rolesCache = snap;
    inflightRoles = null;
    return snap;
  }).catch((err) => {
    inflightRoles = null;
    throw err;
  });
  return inflightRoles;
}

export async function loadAllRoles(): Promise<ReadonlyArray<RoleRow>> {
  const snap = await getRolesSnapshot();
  return snap.orderedByPosition;
}

export async function loadRoleById(id: number): Promise<RoleRow | null> {
  const snap = await getRolesSnapshot();
  return snap.byId.get(id) ?? null;
}

export async function loadRoleByKey(key: string): Promise<RoleRow | null> {
  const snap = await getRolesSnapshot();
  return snap.byKey.get(key) ?? null;
}

export function invalidateRoleCache(): void {
  rolesCache = null;
}

// ─── Per-staff assignment cache ─────────────────────────────────────────

interface StaffAssignmentSnapshot {
  roleIds: number[];
  expiresAt: number;
}

const STAFF_ROLES_TTL_MS = 60_000;
const staffRolesCache = new Map<number, StaffAssignmentSnapshot>();

/**
 * Load role ids assigned to a staff. Order: roles.position ASC (primary
 * role first). Stale entries are refreshed on next read; an explicit
 * invalidate is used after writes for instant correctness.
 */
export async function loadStaffRoleIds(staffId: number): Promise<number[]> {
  const cached = staffRolesCache.get(staffId);
  if (cached && cached.expiresAt > Date.now()) return cached.roleIds;
  const r = await pool.query(
    `SELECT sr.role_id
       FROM staff_roles sr
       JOIN roles r ON r.id = sr.role_id
      WHERE sr.staff_id = $1
      ORDER BY r.position ASC, r.id ASC`,
    [staffId],
  );
  const roleIds = (r.rows as Array<{ role_id: number }>).map((row) => row.role_id);
  staffRolesCache.set(staffId, { roleIds, expiresAt: Date.now() + STAFF_ROLES_TTL_MS });
  return roleIds;
}

export async function loadRolesForStaff(staffId: number): Promise<RoleRow[]> {
  const [ids, snap] = await Promise.all([loadStaffRoleIds(staffId), getRolesSnapshot()]);
  const out: RoleRow[] = [];
  for (const id of ids) {
    const r = snap.byId.get(id);
    if (r) out.push(r);
  }
  return out;
}

export function invalidateStaffRolesCache(staffId?: number): void {
  if (staffId == null) {
    staffRolesCache.clear();
  } else {
    staffRolesCache.delete(staffId);
  }
}

// ─── Effective permission helpers (server-side, DB-backed) ──────────────

/**
 * Computes the effective permission set for a staff: UNION of all assigned
 * role permissions ∪ `permissions_added` \ `permissions_removed`. If any
 * assigned role has key 'admin', short-circuits to "all known permissions".
 *
 * Mirrors Discord's Administrator bypass.
 */
export async function effectivePermissionsForStaff(
  staffId: number,
  overrides: { added?: ReadonlyArray<string>; removed?: ReadonlyArray<string> } = {},
): Promise<Set<PermissionString>> {
  const roles = await loadRolesForStaff(staffId);
  return computeEffectivePermissions(roles, overrides.added ?? [], overrides.removed ?? []);
}

/**
 * Primary role for a staff (used for legacy `staff.role` consumers and the
 * avatar theme color). Returns null if the staff has no role assignments.
 */
export async function primaryRoleForStaff(staffId: number): Promise<RoleRow | null> {
  const roles = await loadRolesForStaff(staffId);
  return roles[0] ?? null;
}
