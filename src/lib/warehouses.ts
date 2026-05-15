import pool from '@/lib/db';

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

export async function listWarehouses(): Promise<Warehouse[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const r = await pool.query<Warehouse>(
    `SELECT id, code, name, timezone, is_active, is_default
     FROM warehouses
     WHERE is_active = true
     ORDER BY is_default DESC, code ASC`,
  );
  cached = { rows: r.rows, expiresAt: Date.now() + TTL_MS };
  return r.rows;
}

export async function getDefaultWarehouse(): Promise<Warehouse | null> {
  const all = await listWarehouses();
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
export async function resolveWarehouseId(opts: {
  override?: number | null;
  staffId?: number | null;
}): Promise<number | null> {
  if (opts.override && Number.isFinite(opts.override) && opts.override > 0) {
    return Math.floor(opts.override);
  }
  if (opts.staffId) {
    const r = await pool.query<{ default_warehouse_id: number | null }>(
      `SELECT default_warehouse_id FROM staff WHERE id = $1 LIMIT 1`,
      [opts.staffId],
    );
    const fromStaff = r.rows[0]?.default_warehouse_id;
    if (fromStaff) return fromStaff;
  }
  const def = await getDefaultWarehouse();
  return def?.id ?? null;
}
