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
 * Google Drive photo backup. Global kill-switch for the drive-mirror cron + the
 * manual backup batch. Default ON so any tenant who connects their Drive gets
 * backed up; the per-org gate is the presence of an active google_drive vault
 * connection, so this only exists to halt the feature platform-wide.
 */
export function isPhotosDriveBackupEnabled(): boolean {
  return readBoolEnv('PHOTOS_DRIVE_BACKUP_ENABLED', true);
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
 * Auto-link a returned serial to its originating order on the normal unbox
 * serial scan (the shipped↔returned loop). When ON, scanning a serial whose
 * unit was previously SHIPPED resolves the prior sales order, flips its open
 * SHIPPED allocation → RETURNED, persists the per-line source order + listing
 * link, and promotes an unfound carton to a found RETURN — all in one request,
 * so the workspace can display + pre-fill instantly (see
 * src/lib/receiving/returned-serial-link.ts). Default ON: the resolve is
 * skipped unless the scan is a return, the writes are idempotent + reversible
 * (detach the serial), and a real Zoho-PO carton is never reclassified. Set
 * RECEIVING_RETURN_AUTOLINK=false to fall back to detect-and-display only.
 */
export function isReceivingReturnAutolink(): boolean {
  return readBoolEnv('RECEIVING_RETURN_AUTOLINK', true);
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
 * Per-org verdict→status override (Wave 2 / Class A — the §3.A verdict map config
 * deferred out of the Class-D reason-codes work). When ON, recordTestVerdict
 * resolves a tenant's verdict→status mapping from organizations.settings
 * (workflow.verdictStatus), falling back to the hardcoded VERDICT_TO_STATUS for
 * any unset verdict. Default OFF — when off, the hardcoded map is used with NO
 * settings read, so behavior is byte-identical. Set UNIFIED_ENGINE_VERDICT_CONFIG=true.
 */
export function isUnifiedEngineVerdictConfig(): boolean {
  return readBoolEnv('UNIFIED_ENGINE_VERDICT_CONFIG');
}

/**
 * Shipped-table read model. When ON, the /api/packerlogs week query reads the
 * precomputed `packer_log_enrichment` projection (catalog title / v_sku lookup /
 * order match / tracking json) via a 1:1 join instead of re-running the ~6
 * non-indexable LATERAL subqueries per row. Volatile carrier status stays a live
 * join either way. Default OFF — the off branch is the byte-identical legacy
 * query, so this is a no-op until the table is backfilled and the flag flipped.
 * Set PACKER_LOG_ENRICHMENT_READ=true once
 * scripts/backfill-packer-log-enrichment.mjs has run. See
 * src/lib/neon/packer-log-enrichment.ts.
 */
export function isPackerLogEnrichmentRead(): boolean {
  return readBoolEnv('PACKER_LOG_ENRICHMENT_READ');
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

/**
 * Decision-node ZEN evaluator cutover (UNIFIED-ENGINE-MASTER-PLAN §1.6, Stage 2).
 * When ON, the `decision` node routes through the GoRules ZEN expression engine
 * (@gorules/zen-engine-wasm) instead of the in-house rule-table matcher
 * (src/lib/workflow/decision-eval.ts). The operator-editable rule table is
 * compiled to an equivalent ZEN expression at evaluation time and evaluated in
 * WASM; the node, editor, config shape, and result (a port id, or null → park) are
 * all unchanged — this swaps only the matching ENGINE, not behavior. The ZEN path
 * is itself guarded: if the WASM module can't load/init, it transparently falls
 * back to the in-house evaluator, so a miss is a no-op rather than a broken route.
 * Default OFF: until flipped, evaluation is byte-identical Stage-1 in-house
 * matching and the WASM module is never loaded. Set DECISION_ENGINE_ZEN=true to
 * enable. See src/lib/workflow/decision-eval-zen.ts.
 */
export function isDecisionEngineZen(): boolean {
  return readBoolEnv('DECISION_ENGINE_ZEN');
}

/**
 * Placement-strangle OBSERVE-ONLY parity logging (UNIFIED-ENGINE-MASTER-PLAN
 * §1.6 Track 1, Stage 1.x). When ON, a converting placement site (parts-sort
 * first) ALSO computes what the declarative decision-table → resolvePlacementBin
 * mechanism WOULD pick, and logs match / DIVERGENCE / unseeded against the bin
 * the live hardcoded path actually used. It changes NO behavior — the hardcoded
 * path stays the source of truth; this only proves the new mechanism yields the
 * identical bin before any site is flipped to consume it (PLACEMENT_STRANGLE_*
 * per-site flags do the actual cutover, later). Fire-and-forget + self-guarded,
 * so a parity-observer fault never affects the real move. Default OFF — set
 * PLACEMENT_PARITY_OBSERVE=true to start collecting parity signal in an env.
 */
export function isPlacementParityObserve(): boolean {
  return readBoolEnv('PLACEMENT_PARITY_OBSERVE');
}

/**
 * Placement-strangle CUTOVER for parts-sort (UNIFIED-ENGINE-MASTER-PLAN §1.6
 * Track 1, Stage 1.x — the first live site). When ON, sortSerialUnitToParts
 * resolves its destination bin from the declarative placement policy (the org's
 * Studio decision nodes → the system-default parts policy → resolvePlacementBin)
 * instead of the hardcoded env-constant resolvePartsBin(). It degrades to the
 * env-constant bin whenever the policy resolves nothing, so flipping it ON with
 * no decision node authored is byte-identical to today (the system-default policy
 * targets the same PARTS_BIN_BARCODE). Default OFF — flip per env after the
 * PLACEMENT_PARITY_OBSERVE window shows a clean `match`. Set
 * PLACEMENT_STRANGLE_PARTS_SORT=true to enable.
 */
export function isPlacementStranglePartsSort(): boolean {
  return readBoolEnv('PLACEMENT_STRANGLE_PARTS_SORT');
}

/**
 * Placement-strangle CUTOVER for receiving default-putaway (UNIFIED-ENGINE-MASTER-PLAN
 * §1.6 Track 1, Stage 1.x — second live site). When ON, mark-received resolves the
 * default putaway bin (disposition=ACCEPT, no operator-scanned bin) from the
 * declarative placement policy (org Studio decision nodes → the system-default
 * receiving policy → a RESERVE+active bin lookup) instead of the env/settings
 * resolveDefaultPutawayBinId(). It degrades to the legacy bin whenever the policy
 * resolves nothing, and the system-default policy targets the org's configured
 * default-putaway barcode via the SAME RESERVE+active lookup — so ON with no
 * decision node authored is byte-identical to today. Default OFF — flip per env
 * after the PLACEMENT_PARITY_OBSERVE window is clean. Set
 * PLACEMENT_STRANGLE_RECEIVING_PUTAWAY=true to enable.
 */
export function isPlacementStrangleReceivingPutaway(): boolean {
  return readBoolEnv('PLACEMENT_STRANGLE_RECEIVING_PUTAWAY');
}

/**
 * Config-driven RMA restock placement (UNIFIED-ENGINE-MASTER-PLAN §1.6 Track 1,
 * Stage 1.x — third site). Unlike parts-sort / receiving-putaway, RMA restock has
 * NO legacy hardcoded bin: an ACCEPT'd inbound return goes RETURNED→STOCKED with
 * no bin today. When ON, recordDisposition consults the org's Studio decision
 * policy (NO system default — purely opt-in) for a restock bin and threads it
 * into the restock transition + current_location. With no decision node authored
 * it resolves nothing → restock stays bin-less, exactly as today. So this is
 * additive: it never changes an existing placement, only enables one an org
 * configures. Default OFF. Set PLACEMENT_STRANGLE_RMA_RESTOCK=true to enable.
 */
export function isPlacementStrangleRmaRestock(): boolean {
  return readBoolEnv('PLACEMENT_STRANGLE_RMA_RESTOCK');
}

/**
 * Fulfillment substitution / order-line amendment capability (the
 * ordered-vs-fulfilled deviation flow: release the original allocation +
 * allocate a substitute unit, recorded in order_unit_amendments).
 *
 * This is the rollout MASTER SWITCH only — it gates whether the substitute
 * action is exposed/accepted at all. The behavioral knobs are NOT here:
 *   - WHICH node may raise an amendment (default 'pick'),
 *   - advisory vs block_until_approved enforcement,
 *   - propagation reach (internal / notify-customer / channel-sync),
 * all live per-org in the settings registry (docs/settings-registry.md) so a
 * tenant tunes them from /studio without an env redeploy. Default OFF until the
 * 2026-06-27e_order_unit_amendments migration is applied + the flow is verified.
 * Set FULFILLMENT_SUBSTITUTION=true to enable.
 */
export function isFulfillmentSubstitution(): boolean {
  return readBoolEnv('FULFILLMENT_SUBSTITUTION');
}

/**
 * Dual-write owner↔tracking linkage into the unified `shipment_links` table.
 *
 * When ON, the linkage writers (attachBoxToReceiving inbound, applyOrderTrackingOps
 * outbound — wired incrementally) ALSO upsert shipment_links alongside their legacy
 * junction (receiving_shipments / order_shipment_links). The READ path stays on the
 * legacy junctions during the bake; this just keeps shipment_links current beyond
 * the one-time backfill (2026-06-24_shipment_links.sql). Default OFF: until flipped,
 * behavior is byte-identical to today. Enable once parity is verified, ahead of the
 * read cutover. Default ON as of the Phase 4b cutover (the dual-write is
 * additive + same-tx so shipment_links can't drift from the junction); set
 * RECEIVING_SHIPMENT_LINKS_DUAL_WRITE=false to disable if ever needed.
 */
export function isShipmentLinksDualWrite(): boolean {
  return readBoolEnv('RECEIVING_SHIPMENT_LINKS_DUAL_WRITE', true);
}

/**
 * Universal Incoming (docs/incoming-universal-purchase-orders-plan.md §6, §8.3).
 * Per-org, async, env-fallback. When ON, `view=incoming` also surfaces
 * eBay-buyer-originated Incoming lines (inbound_source_type='ebay') alongside
 * Zoho POs, the `?inbound=` facet filters by source, and the Zoho receiving sync
 * runs the eBay↔Zoho merge. Default OFF — when off, Incoming is the byte-identical
 * Zoho-only path and the merge hook is a no-op, so a tenant not using buyer
 * accounts is unaffected. Enable per org (organization_feature_flags(flag=
 * 'incoming_universal')) once they connect a buyer account, or globally via
 * INCOMING_UNIVERSAL=true.
 */
export async function isIncomingUniversal(orgId: OrgId): Promise<boolean> {
  return resolveForOrg(orgId, 'incoming_universal', 'INCOMING_UNIVERSAL');
}

