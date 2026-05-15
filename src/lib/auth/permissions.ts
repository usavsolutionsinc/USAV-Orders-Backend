import pool from '@/lib/db';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StaffRole =
  | 'packer'
  | 'receiving'
  | 'technician'
  | 'sales'
  | 'admin'
  | 'readonly'
  | 'unknown';

/**
 * Actions gated by role. New gates should be added here, not inline in
 * route handlers, so changes stay centralized.
 */
export type PermissionAction =
  | 'bin.adjust'           // put / take qty via the numpad
  | 'bin.set'              // set qty / min / max (Apply Limits)
  | 'bin.rename'           // change SKU display_name_override
  | 'bin.swap'             // change which SKU is in a bin row
  | 'bin.remove'           // soft-remove (set qty=0)
  | 'bin.add_sku'          // BinAddSkuSheet → put new SKU into bin
  | 'cycle_count.approve'; // future: variance approval

const ROLE_PERMISSIONS: Record<Exclude<StaffRole, 'unknown'>, ReadonlyArray<PermissionAction>> = {
  packer:     ['bin.adjust', 'bin.set', 'bin.add_sku'],
  receiving:  ['bin.adjust', 'bin.set', 'bin.add_sku'],
  technician: ['bin.adjust', 'bin.set', 'bin.add_sku'],
  sales:      ['bin.adjust', 'bin.set', 'bin.add_sku'],
  // Admin is a superset — destructive actions live here.
  admin: [
    'bin.adjust', 'bin.set', 'bin.add_sku',
    'bin.rename', 'bin.swap', 'bin.remove',
    'cycle_count.approve',
  ],
  readonly: [],
};

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
    const r = await pool.query<{ role: string | null }>(
      `SELECT role FROM staff WHERE id = $1 LIMIT 1`,
      [staffId],
    );
    const raw = (r.rows[0]?.role || '').trim().toLowerCase();
    const role: StaffRole =
      raw === 'packer' ||
      raw === 'receiving' ||
      raw === 'technician' ||
      raw === 'sales' ||
      raw === 'admin' ||
      raw === 'readonly'
        ? (raw as StaffRole)
        : 'unknown';
    cache.set(staffId, { role, expiresAt: Date.now() + CACHE_TTL_MS });
    return role;
  } catch {
    return 'unknown';
  }
}

export function hasPermission(role: StaffRole, action: PermissionAction): boolean {
  if (role === 'unknown') return false;
  if (role === 'readonly') return false;
  return ROLE_PERMISSIONS[role].includes(action);
}

/**
 * Server-side gate: throw a normalized error if the staff lacks permission.
 * Route handlers catch this and convert to 403.
 */
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

/**
 * Normalized 403 body for clients to parse. Lets the UI render
 * "you need admin role" instead of a generic error.
 */
export function permissionDeniedResponse(err: PermissionDeniedError) {
  return {
    error: 'FORBIDDEN',
    action: err.action,
    role: err.role,
    message: `Your role (${err.role}) cannot perform this action.`,
  };
}
