/**
 * Feature flags — sync env-only + async per-tenant infrastructure.
 * ────────────────────────────────────────────────────────────────────
 * The inventory rewrite is COMPLETE: the unit-level engine (serial_units +
 * inventory_events + sku_stock_ledger + order_unit_allocations) is the only
 * inventory system and runs unconditionally. The former INVENTORY_V2_* flags
 * were removed on 2026-06-14 — there is no V1 path left to gate against.
 *
 * What remains here:
 *   - readBoolEnv(name, default): the sync env-var primitive backing the
 *     handful of product flags below (warranty logger, mobile-receiving
 *     pipeline, receiving physical-state-first / unified-inbound).
 *   - resolveForOrg() + the 30s (orgId, flag) cache: the per-tenant
 *     resolution framework (reads organization_feature_flags, env fallback).
 *     Kept as reusable infrastructure for future per-org flags; invalidate
 *     explicitly via invalidateFeatureFlagCache() when a row is flipped.
 */

import pool from '@/lib/db';
import type { OrgId } from './tenancy/constants';

function readBoolEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return defaultValue;
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

/**
 * Public reader for a per-org override flag with no env fallback. Returns the
 * stored boolean, or `null` when the org has no row for `flag` (so callers can
 * distinguish "explicitly off" from "unset"). Shares the same 30s cache as
 * resolveForOrg and is fail-open (returns null, logged) on a DB error.
 *
 * Used by the Studio entitlement gate to honor a force-grant override
 * (organization_feature_flags(flag='studio')) alongside the plan catalog.
 */
export async function readOrgFeatureFlag(orgId: OrgId, flag: string): Promise<boolean | null> {
  return readOrgFlag(orgId, flag);
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

// ─── Sync env-only variants ────────────────────────────────────────────────
//
// NOTE: The INVENTORY_V2_* flags were removed on 2026-06-14. The unit-level
// inventory engine (serial_units + inventory_events + sku_stock_ledger +
// order_unit_allocations) is now the ONLY inventory system — always on, no
// flag. The receive→putaway, tech-lifecycle, allocation/pick, pack/ship,
// FBA-serial-link, returns/holds, picking, bin-roles, replenishment, and RMA
// phases all run unconditionally. There is no V1 path left to fall back to.

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

/**
 * Warranty Claim Logger + Repair Outcome Tracker — 4th mode on the Orders /
 * Shipping page. Now GA: always on, so the support tool is never disabled and
 * the read/write routes + clock sweep always serve data. The env var is honored
 * as a kill-switch only — set WARRANTY_LOGGER=false to force it off.
 * See docs/warranty-claim-logger-plan.md.
 */
export function isWarrantyLogger(): boolean {
  return readBoolEnv('WARRANTY_LOGGER', true);
}

/**
 * Physical-state-first receiving queues (receiving-triage streamline Phase 2).
 * When ON, the triage SCANNED/Prioritize queue no longer hard-excludes POs Zoho
 * marks received/closed — a box physically on the dock stays visible (with a
 * "Zoho: received" badge), and the "Hide Zoho-received" toggle (?zohoStatus=open)
 * re-applies the old filter. Scoped to view=scanned only; Incoming still clears
 * Zoho-received POs by design. Default ON; set
 * RECEIVING_PHYSICAL_STATE_FIRST=false to revert.
 */
export function isReceivingPhysicalStateFirst(): boolean {
  return readBoolEnv('RECEIVING_PHYSICAL_STATE_FIRST', true);
}

/**
 * Unified inbound model (receiving-triage streamline Phase 3). When ON,
 * incoming-po-sync registers a shipment per incoming PO and stamps
 * receiving_lines.shipment_id, the delivered-unscanned surface joins line-level
 * SKU/order#, and lookup-po matches by LPN / shipment_id first (last-8 tracking
 * fallback). Requires the 2026-06-08_inbound_handling_unit migration applied +
 * backfill. Default OFF until the migration lands and backfill runs.
 */
export function isReceivingUnifiedInbound(): boolean {
  return readBoolEnv('RECEIVING_UNIFIED_INBOUND');
}

/**
 * Unified-engine chokepoint cutover (UNIFIED-ENGINE-MASTER-PLAN §1.1). When ON,
 * domain handlers route their serial-unit status change + inventory event +
 * engine tap through the single guarded applyTransition() chokepoint instead of
 * a hand-rolled raw UPDATE + appendInventoryEvent + tap. recordTestVerdict is the
 * reference call site. Default OFF — when off, every converted handler takes its
 * byte-identical legacy path, so this is a no-op until explicitly enabled per
 * environment. Flip to true once per-site parity is verified, then delete the
 * legacy branch. Set UNIFIED_ENGINE_APPLY_TRANSITION=true to enable.
 */
export function isUnifiedEngineApplyTransition(): boolean {
  return readBoolEnv('UNIFIED_ENGINE_APPLY_TRANSITION');
}

/**
 * Unified-engine fulfillment-tail taps (UNIFIED-ENGINE-MASTER-PLAN §1.4). When
 * ON, the domain mutations that finish the lifecycle fire their engine taps so a
 * unit flows past the dormant tail of the graph:
 *   - /api/serial-units/[id]/list → tapWorkflow('listed')   (list_ebay → pack)
 *   - /api/pack/ship              → tapWorkflow('packed')   (pack → ship node)
 *                                 → tapWorkflow('shipped')  (ship → done; terminal)
 * All are fire-and-forget observers (tapWorkflow never throws, drops unenrolled
 * units), so this only advances the engine's graph position — it changes no
 * domain state. The irreversible carrier custody already commits in the pack/ship
 * transaction; the 'shipped' tap merely records the unit reached the terminal
 * node. Default OFF: until flipped, the listing fact is still recorded and the
 * pack still ships, but the engine isn't told, exactly as today. Enable once the
 * serial_unit_listings migration is applied and parity is verified. Set
 * UNIFIED_ENGINE_FULFILLMENT_TAPS=true to enable.
 */
export function isUnifiedEngineFulfillmentTaps(): boolean {
  return readBoolEnv('UNIFIED_ENGINE_FULFILLMENT_TAPS');
}

