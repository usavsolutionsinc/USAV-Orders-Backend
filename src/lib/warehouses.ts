import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  timezone: string;
  is_active: boolean;
  is_default: boolean;
}

// Module cache — warehouses rarely change. Fluid Compute reuses the instance
// so the cache survives across requests.
let cached: { rows: Warehouse[]; expiresAt: number } | null = null;
const TTL_MS = 5 * 60_000;
// Per-org cache for the tenant-aware path. The shared `cached` above is the
// pre-tenancy global path (orgId omitted) and stays byte-identical; we key the
// tenant path separately so an org never serves another org's rows from cache.
const cachedByOrg = new Map<OrgId, { rows: Warehouse[]; expiresAt: number }>();

const LIST_WAREHOUSES_SQL = `SELECT id, code, name, timezone, is_active, is_default
     FROM warehouses
     WHERE is_active = true
     ORDER BY is_default DESC, code ASC`;

export async function listWarehouses(orgId?: OrgId): Promise<Warehouse[]> {
  // Tenant-aware path. `warehouses` has NO organization_id column (NEEDS-COL)
  // and no org-bearing parent, so isolation is the GUC/RLS backstop applied by
  // tenantQuery — there is no column to add an explicit predicate against.
  if (orgId) {
    const hit = cachedByOrg.get(orgId);
    if (hit && hit.expiresAt > Date.now()) return hit.rows;
    const r = await tenantQuery<Warehouse>(orgId, LIST_WAREHOUSES_SQL);
    cachedByOrg.set(orgId, { rows: r.rows, expiresAt: Date.now() + TTL_MS });
    return r.rows;
  }
  // Legacy path — byte-identical to pre-tenancy behavior.
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const r = await pool.query<Warehouse>(LIST_WAREHOUSES_SQL);
  cached = { rows: r.rows, expiresAt: Date.now() + TTL_MS };
  return r.rows;
}

export async function getDefaultWarehouse(orgId?: OrgId): Promise<Warehouse | null> {
  const all = await listWarehouses(orgId);
  return all.find((w) => w.is_default) ?? all[0] ?? null;
}

/**
 * Resolve warehouse_id for a write. Caller may pass:
 *   • explicit override (request header or body field)
 *   • a staffId — we look up staff.default_warehouse_id
 *   • neither — falls back to the active default warehouse
 *
 * Always returns a valid id when at least one warehouse exists.
 */
export async function resolveWarehouseId(
  opts: {
    override?: number | null;
    staffId?: number | null;
  },
  orgId?: OrgId,
): Promise<number | null> {
  if (opts.override && Number.isFinite(opts.override) && opts.override > 0) {
    return Math.floor(opts.override);
  }
  if (opts.staffId) {
    let fromStaff: number | null | undefined;
    if (orgId) {
      // `staff` carries organization_id (NOT NULL) — add the explicit predicate
      // and run under the tenant GUC so a staffId can't resolve cross-org.
      const r = await tenantQuery<{ default_warehouse_id: number | null }>(
        orgId,
        `SELECT default_warehouse_id FROM staff WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [opts.staffId, orgId],
      );
      fromStaff = r.rows[0]?.default_warehouse_id;
    } else {
      const r = await pool.query<{ default_warehouse_id: number | null }>(
        `SELECT default_warehouse_id FROM staff WHERE id = $1 LIMIT 1`,
        [opts.staffId],
      );
      fromStaff = r.rows[0]?.default_warehouse_id;
    }
    if (fromStaff) return fromStaff;
  }
  const def = await getDefaultWarehouse(orgId);
  return def?.id ?? null;
}
