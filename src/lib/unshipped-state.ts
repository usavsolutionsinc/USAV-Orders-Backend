/**
 * Unshipped (pre‑dock) package state — shared derivation helpers for the full
 * sold → label → test → pack → dock pipeline.
 *
 * **Surface ownership (2026-06):**
 * - `AWAITING_LABEL` → Outbound · Labels (`/outbound`)
 * - `PENDING` / `TESTED` / `BLOCKED` → Dashboard · Unshipped (`deriveFulfillmentState`)
 * - `PACKED_STAGED` → Outbound · Scan-out; seam color shared with `outbound-state.ts`
 * - Post-dock states → `outbound-state.ts` on Dashboard · Shipped
 *
 * This is the inbound mirror of {@link OUTBOUND_STATE_META} in `outbound-state.ts`.
 * The two models meet at ONE shared seam state, `PACKED_STAGED`: it is the
 * terminal unshipped state AND the initial outbound state, so the dock scan‑out
 * is exactly the `PACKED_STAGED → SCANNED_OUT` transition that hands a package
 * from this model to the outbound one. To guarantee the seam never drifts, the
 * `PACKED_STAGED` dot/pill colors here are re‑used from the outbound meta.
 *
 * Color rule: no two status dots across BOTH models share a hue. The unshipped
 * states claim slate / yellow / teal / red; `PACKED_STAGED` is the shared amber;
 * the outbound states own blue / indigo / emerald / rose / orange / pink.
 *
 * Pure + isomorphic (no React, no DOM, no Date.now): safe on client and server.
 * "Late" is a deadline overlay, not a pipeline stage — see {@link isUnshippedLate}.
 */

import { buildStateMeta } from '@/lib/labels/resolve';
import {
  resolveOrderLifecycleStage,
  resolveFulfillmentLane,
  type OrderLifecycleStage,
  type FulfillmentLane,
  type OrderLifecycleSignals,
} from '@/lib/order-lifecycle';

/**
 * Pre‑dock pipeline state. The canonical vocabulary + derivation now live in
 * `order-lifecycle.ts` (the single projection per W2 of the engine‑migration
 * plan); these are re‑exported here so existing importers and the
 * `*_STATE_META` color maps below keep their stable import path. Color/label
 * presentation stays in this module.
 */
export type UnshippedState = OrderLifecycleStage;
/** Pre-pack fulfillment lanes shown on Dashboard · Unshipped (excludes label + dock). */
export type FulfillmentState = FulfillmentLane;
export type UnshippedStateInput = OrderLifecycleSignals;

/**
 * Derive the pre‑dock pipeline state — thin alias over the canonical projection
 * (`resolveOrderLifecycleStage`). Kept for import‑path stability.
 */
export function deriveUnshippedState(input: UnshippedStateInput): UnshippedState {
  return resolveOrderLifecycleStage(input);
}

/** Derive fulfillment-queue lane for orders that already have a label/tracking. */
export function deriveFulfillmentState(input: UnshippedStateInput): FulfillmentState {
  return resolveFulfillmentLane(input);
}

export type FulfillmentCounts = Record<FulfillmentState, number>;

export const ZERO_FULFILLMENT_COUNTS: FulfillmentCounts = {
  PENDING: 0,
  TESTED: 0,
  BLOCKED: 0,
};

/** Bucket fulfillment-queue rows for the Unshipped status legend. */
export function countFulfillmentStates(
  rows: ReadonlyArray<{
    shipment_id?: number | string | null;
    has_tech_scan?: boolean | null;
    out_of_stock?: string | null;
  }>,
): FulfillmentCounts {
  const counts: FulfillmentCounts = { ...ZERO_FULFILLMENT_COUNTS };
  for (const r of rows) {
    const state = deriveFulfillmentState({
      shipmentId: r.shipment_id,
      hasTechScan: Boolean(r.has_tech_scan),
      outOfStock: r.out_of_stock,
    });
    counts[state] += 1;
  }
  return counts;
}

/** True when the deadline has passed. Overlay flag (the days‑late chip), not a dot. */
export function isUnshippedLate(deadlineAt: string | null | undefined, now: Date): boolean {
  if (!deadlineAt) return false;
  const t = new Date(deadlineAt).getTime();
  return Number.isFinite(t) && t < now.getTime();
}

export type UnshippedCounts = Record<UnshippedState, number>;

export const ZERO_UNSHIPPED_COUNTS: UnshippedCounts = {
  AWAITING_LABEL: 0,
  PENDING: 0,
  TESTED: 0,
  PACKED_STAGED: 0,
  BLOCKED: 0,
};

/** Bucket rows by derived pre‑dock state — feeds the unshipped status legend counts. */
export function countUnshippedStates(
  rows: ReadonlyArray<{
    shipment_id?: number | string | null;
    has_tech_scan?: boolean | null;
    packed_at?: string | null;
    out_of_stock?: string | null;
  }>,
): UnshippedCounts {
  const counts: UnshippedCounts = { ...ZERO_UNSHIPPED_COUNTS };
  for (const r of rows) {
    const state = deriveUnshippedState({
      shipmentId: r.shipment_id,
      hasTechScan: Boolean(r.has_tech_scan),
      packedAt: r.packed_at,
      outOfStock: r.out_of_stock,
    });
    counts[state] += 1;
  }
  return counts;
}

export interface UnshippedStateMeta {
  label: string;
  /** One‑line plain‑English meaning — surfaced as the hover tooltip on dots + legend chips. */
  description: string;
  /** Tailwind classes for a compact pill (bg + text + ring). */
  pill: string;
  /** Tailwind bg class for a status dot. */
  dot: string;
}

// Presentation now flows from the one label registry (`src/lib/labels`) — the
// label/description/tone are seeded defaults there and are tenant‑overridable
// (Phase 2). The no‑two‑dots‑share‑a‑hue invariant + the PACKED_STAGED seam
// (shared amber with outbound) are preserved by the registry's distinct tones;
// `labels/resolve.test.ts` pins this map byte‑identical to the former literals.
export const UNSHIPPED_STATE_META = buildStateMeta('unshipped') as Record<UnshippedState, UnshippedStateMeta>;

/** Legend meta for Dashboard · Unshipped only (PENDING / TESTED / BLOCKED). */
export const FULFILLMENT_STATE_META: Record<FulfillmentState, UnshippedStateMeta> = {
  PENDING: UNSHIPPED_STATE_META.PENDING,
  TESTED: UNSHIPPED_STATE_META.TESTED,
  BLOCKED: UNSHIPPED_STATE_META.BLOCKED,
};
