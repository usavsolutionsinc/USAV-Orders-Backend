/**
 * Feature flags — sync env-only + async per-tenant variants.
 * ────────────────────────────────────────────────────────────────────
 * Each phase of the inventory rewrite (context/inventory_system_upgrade_plan.md)
 * lands behind one of these flags. Default OFF; flip on after the workflow
 * has been validated end-to-end against the new event/ledger pathway.
 *
 * Two function variants per flag:
 *
 *   isInventoryV2X(): boolean
 *     Sync, env-var only. Kept for the existing single-tenant callsites
 *     during the transition. Reads INVENTORY_V2_X from process.env.
 *
 *   isInventoryV2XForOrg(orgId): Promise<boolean>
 *     Async, per-tenant. Reads organization_feature_flags first; falls back
 *     to the env-var default if no row exists. Migrate callsites to this
 *     form as they pick up an orgId from withAuth's ctx.
 *
 * Per-tenant reads are cached 30s in-process keyed by (orgId, flag).
 * Cache invalidation is explicit via invalidateFeatureFlagCache() — the
 * admin UI that flips a flag must call it.
 */

import pool from '@/lib/db';
import type { OrgId } from './tenancy/constants';

function readBoolEnv(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

// ─── Per-tenant override cache ─────────────────────────────────────────────
interface CacheEntry {
  enabled: boolean;
  expiresAt: number;
}

const flagCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function cacheKey(orgId: OrgId, flag: string): string {
  return `${orgId}:${flag}`;
}

async function readOrgFlag(orgId: OrgId, flag: string): Promise<boolean | null> {
  const key = cacheKey(orgId, flag);
  const cached = flagCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.enabled;

  try {
    const r = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM organization_feature_flags
        WHERE organization_id = $1 AND flag = $2 LIMIT 1`,
      [orgId, flag],
    );
    const row = r.rows[0];
    if (!row) return null;
    flagCache.set(key, { enabled: row.enabled, expiresAt: Date.now() + CACHE_TTL_MS });
    return row.enabled;
  } catch (err) {
    // Don't fail-closed on a flag read — fall back to env so the request
    // path stays alive. Log so the failure isn't silent.
    console.warn(`[feature-flags] failed reading ${flag} for ${orgId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function resolveForOrg(orgId: OrgId, flag: string, envVar: string): Promise<boolean> {
  const override = await readOrgFlag(orgId, flag);
  if (override !== null) return override;
  return readBoolEnv(envVar);
}

export function invalidateFeatureFlagCache(orgId?: OrgId, flag?: string): void {
  if (!orgId) {
    flagCache.clear();
    return;
  }
  if (!flag) {
    for (const key of flagCache.keys()) {
      if (key.startsWith(`${orgId}:`)) flagCache.delete(key);
    }
    return;
  }
  flagCache.delete(cacheKey(orgId, flag));
}

// ─── Sync env-only variants (legacy callsites) ─────────────────────────────

/**
 * Phase 2 — receiving putaway in one step.
 * When ON, mark-received emits inventory_events (RECEIVED + optional PUTAWAY)
 * and appends sku_stock_ledger rows for Tier 1/2 quantity in the same
 * transaction as the line update + serial_units upsert.
 */
export function isInventoryV2ReceivingPutaway(): boolean {
  return readBoolEnv('INVENTORY_V2_RECEIVING_PUTAWAY');
}

/** Phase 3 — tech station writes through serial_units + inventory_events. */
export function isInventoryV2TechLifecycle(): boolean {
  return readBoolEnv('INVENTORY_V2_TECH_LIFECYCLE');
}

/** Phase 4 — order allocation enabled (Zoho webhook auto-allocates). */
export function isInventoryV2Allocation(): boolean {
  return readBoolEnv('INVENTORY_V2_ALLOCATION');
}

/** Phase 5 — packer flow emits SHIPPED and decrements stock in one txn. */
export function isInventoryV2Packing(): boolean {
  return readBoolEnv('INVENTORY_V2_PACKING');
}

/** Phase 6 — FBA scans link specific serial_units to fba_shipment_items. */
export function isInventoryV2FbaSerialLink(): boolean {
  return readBoolEnv('INVENTORY_V2_FBA_SERIAL_LINK');
}

/** Phase 7 — returns intake + on-hold workflow. */
export function isInventoryV2Returns(): boolean {
  return readBoolEnv('INVENTORY_V2_RETURNS');
}

/** Phase A2 — active picking states + picker session API (/m/pick). */
export function isInventoryV2Picking(): boolean {
  return readBoolEnv('INVENTORY_V2_PICKING');
}

/** Phase A3 — typed bin roles + cycle-count locking applied to pickability. */
export function isInventoryV2BinRoles(): boolean {
  return readBoolEnv('INVENTORY_V2_BIN_ROLES');
}

/** Phase A4 — pick-face replenishment task queue + detection cron. */
export function isInventoryV2Replenishment(): boolean {
  return readBoolEnv('INVENTORY_V2_REPLENISHMENT');
}

/** Phase A5 — first-class RMA authorizations + return dispositions. */
export function isInventoryV2Rma(): boolean {
  return readBoolEnv('INVENTORY_V2_RMA');
}

/**
 * Phase 3 cutover — when ON, legacy packer_logs INSERT sites also
 * mirror the SHIPPED state into the v2 system (order_unit_allocations
 * + serial_units + inventory_events) for any order whose units have
 * open allocations. No-op when the order has no allocations.
 *
 * Off by default. Flip after the picker flag flips and reconciliation
 * shows zero unexpected drift.
 */
export function isInventoryV2LegacyPackMirror(): boolean {
  return readBoolEnv('INVENTORY_V2_LEGACY_PACK_MIRROR');
}

/**
 * Mobile receiving pipeline rewrite (/m/receiving).
 * PO-keyed list, per-Purchase-Order-Item detail, dedicated camera surfaces,
 * and 720p client-side downscale before upload. Reads/writes against the
 * same `receiving_lines` + `photos` tables as the legacy /m/r/[id] flow,
 * with `photos.receiving_line_id` added for first-class item-scoped photos.
 */
export function isMobileReceivingPipelineV2(): boolean {
  return readBoolEnv('MOBILE_RECEIVING_PIPELINE_V2');
}

/** Snapshot of all inventory v2 flags. Useful for debug / admin pages. */
export function inventoryV2FlagSnapshot(): Record<string, boolean> {
  return {
    INVENTORY_V2_RECEIVING_PUTAWAY: isInventoryV2ReceivingPutaway(),
    INVENTORY_V2_TECH_LIFECYCLE: isInventoryV2TechLifecycle(),
    INVENTORY_V2_ALLOCATION: isInventoryV2Allocation(),
    INVENTORY_V2_PACKING: isInventoryV2Packing(),
    INVENTORY_V2_FBA_SERIAL_LINK: isInventoryV2FbaSerialLink(),
    INVENTORY_V2_RETURNS: isInventoryV2Returns(),
    INVENTORY_V2_PICKING: isInventoryV2Picking(),
    INVENTORY_V2_BIN_ROLES: isInventoryV2BinRoles(),
    INVENTORY_V2_REPLENISHMENT: isInventoryV2Replenishment(),
    INVENTORY_V2_RMA: isInventoryV2Rma(),
    INVENTORY_V2_LEGACY_PACK_MIRROR: isInventoryV2LegacyPackMirror(),
    MOBILE_RECEIVING_PIPELINE_V2: isMobileReceivingPipelineV2(),
  };
}

// ─── Async per-tenant variants (new callsites) ─────────────────────────────

export function isInventoryV2ReceivingPutawayForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_receiving_putaway', 'INVENTORY_V2_RECEIVING_PUTAWAY');
}

export function isInventoryV2TechLifecycleForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_tech_lifecycle', 'INVENTORY_V2_TECH_LIFECYCLE');
}

export function isInventoryV2AllocationForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_allocation', 'INVENTORY_V2_ALLOCATION');
}

export function isInventoryV2PackingForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_packing', 'INVENTORY_V2_PACKING');
}

export function isInventoryV2FbaSerialLinkForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_fba_serial_link', 'INVENTORY_V2_FBA_SERIAL_LINK');
}

export function isInventoryV2ReturnsForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_returns', 'INVENTORY_V2_RETURNS');
}

export function isInventoryV2PickingForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_picking', 'INVENTORY_V2_PICKING');
}

export function isInventoryV2BinRolesForOrg(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'inventory_v2_bin_roles', 'INVENTORY_V2_BIN_ROLES');
}

export async function inventoryV2FlagSnapshotForOrg(orgId: OrgId): Promise<Record<string, boolean>> {
  const [putaway, tech, alloc, pack, fba, ret, pick, bin] = await Promise.all([
    isInventoryV2ReceivingPutawayForOrg(orgId),
    isInventoryV2TechLifecycleForOrg(orgId),
    isInventoryV2AllocationForOrg(orgId),
    isInventoryV2PackingForOrg(orgId),
    isInventoryV2FbaSerialLinkForOrg(orgId),
    isInventoryV2ReturnsForOrg(orgId),
    isInventoryV2PickingForOrg(orgId),
    isInventoryV2BinRolesForOrg(orgId),
  ]);
  return {
    INVENTORY_V2_RECEIVING_PUTAWAY: putaway,
    INVENTORY_V2_TECH_LIFECYCLE: tech,
    INVENTORY_V2_ALLOCATION: alloc,
    INVENTORY_V2_PACKING: pack,
    INVENTORY_V2_FBA_SERIAL_LINK: fba,
    INVENTORY_V2_RETURNS: ret,
    INVENTORY_V2_PICKING: pick,
    INVENTORY_V2_BIN_ROLES: bin,
  };
}
