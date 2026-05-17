/**
 * Server-side permission helpers — DB-backed pieces of the auth system.
 *
 * The pure types + role/permission matrix + `permissionsForRole` etc. live in
 * `./permissions-shared.ts` so client components can import them without
 * dragging `pg` into the browser bundle. This module re-exports everything
 * from there for backwards compatibility, then adds the DB-using functions.
 */

import pool from '@/lib/db';

export * from './permissions-shared';

import type { PermissionAction, StaffRole } from './permissions-shared';
import { canonicalRole, hasPermission, PermissionDeniedError } from './permissions-shared';

// ─── Resolver cache (60s) ──────────────────────────────────────────────────

interface CacheEntry {
  role: StaffRole;
  expiresAt: number;
}
const cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export async function getStaffRole(staffId: number): Promise<StaffRole> {
  if (!Number.isFinite(staffId) || staffId <= 0) return 'unknown';
  const cached = cache.get(staffId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  try {
    const r = await pool.query(
      `SELECT role FROM staff WHERE id = $1 LIMIT 1`,
      [staffId],
    );
    const firstRow = r.rows[0] as { role: string | null } | undefined;
    const raw = (firstRow?.role || '').trim().toLowerCase();
    const known: ReadonlyArray<StaffRole> = [
      'packer', 'receiver', 'receiving', 'technician', 'sales',
      'shipper', 'inventory_manager', 'viewer', 'readonly', 'admin',
    ];
    const role: StaffRole = (known as ReadonlyArray<string>).includes(raw)
      ? (raw as StaffRole)
      : 'unknown';
    cache.set(staffId, { role, expiresAt: Date.now() + CACHE_TTL_MS });
    return role;
  } catch {
    return 'unknown';
  }
}

/**
 * Server-side gate: throw a normalized error if the staff lacks permission.
 * Route handlers catch this and convert to 403.
 */
export async function assertPermission(
  staffId: number | null | undefined,
  action: PermissionAction,
): Promise<{ role: StaffRole }> {
  const id = Number(staffId);
  const role = await getStaffRole(Number.isFinite(id) ? id : 0);
  if (!hasPermission(role, action)) {
    throw new PermissionDeniedError(action, role, Number.isFinite(id) ? id : null);
  }
  return { role };
}
