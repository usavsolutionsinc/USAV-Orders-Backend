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

import { OUTBOUND_STATE_META } from '@/lib/outbound-state';

export type UnshippedState =
  | 'AWAITING_LABEL' // sold, no tracking/label yet (shipment_id is null)
  | 'PENDING' // labeled, waiting for test/pack
  | 'TESTED' // passed tech scan — ready to pack
  | 'PACKED_STAGED' // packed + staged, awaiting dock scan‑out (shared seam state)
  | 'BLOCKED'; // out of stock / can't fulfill — needs attention

export interface UnshippedStateInput {
  /** orders.shipment_id — null means no tracking/label has been attached yet. */
  shipmentId?: number | string | null;
  /** A tech scan exists (order.tested). */
  hasTechScan?: boolean | null;
  /** PACK event timestamp (pack completed, not merely a packer assigned). */
  packedAt?: string | null;
  /** orders.out_of_stock — a non‑empty string means the line is flagged blocked. */
  outOfStock?: string | null;
}

/**
 * Derive the pre‑dock pipeline state. Precedence is exception‑first within the
 * not‑yet‑packed stages (an out‑of‑stock line needs attention before it can
 * progress), but a completed PACK wins outright — once it is physically packed
 * and staged the stock question is moot and it sits at the seam.
 */
export function deriveUnshippedState(input: UnshippedStateInput): UnshippedState {
  if (input.packedAt) return 'PACKED_STAGED';
  if (String(input.outOfStock ?? '').trim() !== '') return 'BLOCKED';
  if (input.hasTechScan) return 'TESTED';
  if (input.shipmentId != null && String(input.shipmentId) !== '') return 'PENDING';
  return 'AWAITING_LABEL';
}

/** Pre-pack fulfillment states shown on Dashboard · Unshipped (excludes label + dock). */
export type FulfillmentState = 'PENDING' | 'TESTED' | 'BLOCKED';

/** Derive fulfillment-queue state for orders that already have a label/tracking. */
export function deriveFulfillmentState(input: UnshippedStateInput): FulfillmentState {
  if (String(input.outOfStock ?? '').trim() !== '') return 'BLOCKED';
  if (input.hasTechScan) return 'TESTED';
  return 'PENDING';
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

// Every dot hue is distinct from the others AND from every outbound state hue.
// PACKED_STAGED is the shared seam, so its color is sourced from the outbound
// meta to keep the two models locked together.
export const UNSHIPPED_STATE_META: Record<UnshippedState, UnshippedStateMeta> = {
  AWAITING_LABEL: { label: 'Awaiting Label', description: 'Sold — no tracking or label attached yet.',                      pill: 'bg-slate-50 text-slate-600 ring-slate-200',    dot: 'bg-slate-400' },
  PENDING:        { label: 'Pending',        description: 'Labeled and queued — waiting for test/pack.',                    pill: 'bg-yellow-50 text-yellow-700 ring-yellow-200', dot: 'bg-yellow-500' },
  TESTED:         { label: 'Tested',         description: 'Passed the tech scan — ready to pack.',                          pill: 'bg-teal-50 text-teal-700 ring-teal-200',       dot: 'bg-teal-500' },
  PACKED_STAGED:  { label: 'Packed · Staged', description: 'Packed and staged at the dock — awaiting scan‑out.',            pill: OUTBOUND_STATE_META.PACKED_STAGED.pill,         dot: OUTBOUND_STATE_META.PACKED_STAGED.dot },
  BLOCKED:        { label: 'Blocked',        description: 'Out of stock / can’t fulfill — needs attention.',                pill: 'bg-red-50 text-red-700 ring-red-200',          dot: 'bg-red-500' },
};

/** Legend meta for Dashboard · Unshipped only (PENDING / TESTED / BLOCKED). */
export const FULFILLMENT_STATE_META: Record<FulfillmentState, UnshippedStateMeta> = {
  PENDING: UNSHIPPED_STATE_META.PENDING,
  TESTED: UNSHIPPED_STATE_META.TESTED,
  BLOCKED: UNSHIPPED_STATE_META.BLOCKED,
};
