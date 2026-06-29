/**
 * Outbound package state — the single source of truth for "where is this package
 * in the pack → leave‑the‑building → carrier‑custody → delivered timeline".
 *
 * Derived, not stored. A package is packed at one time and physically leaves the
 * warehouse at another, so the dashboard models both moments:
 *   • PACK event (station_activity_logs PACK_COMPLETED/PACK_SCAN)  → "scanned by packer"
 *   • SHIP_CONFIRM event (station_activity_logs SHIP_CONFIRM)       → "left the warehouse"
 *   • carrier milestones on shipping_tracking_numbers              → external custody truth
 *
 * "Invisible staging" is not a place — it's the derived PACKED_STAGED bucket:
 * a PACK event exists, no SHIP_CONFIRM yet, and the carrier hasn't taken custody.
 *
 * Pure + isomorphic (no React, no DOM, no Date.now): safe to import on client and
 * server. Stalled/exception time math is passed in by the caller.
 */

// The outbound stage vocabulary + derivation + custody predicates now live in
// the canonical `order-lifecycle.ts` projection (W2 display‑logic
// consolidation); re‑exported here under their established names so every
// importer + the color META below keep their stable path. This module keeps
// only the presentation (the OUTBOUND_STATE_META hues + the seam contract).
export {
  CUSTODY_CATEGORIES,
  carrierHasCustody,
  hasLeftWarehouse,
  effectiveShipTime,
  resolveOutboundStage as deriveOutboundState,
} from '@/lib/order-lifecycle';
import type { OutboundStage, OutboundSignals } from '@/lib/order-lifecycle';
import { buildStateMeta } from '@/lib/labels/resolve';

/** The post‑dock outbound stage vocabulary. Canonical definition in `order-lifecycle.ts`. */
export type OutboundState = OutboundStage;
export type OutboundStateInput = OutboundSignals;

export interface OutboundStateMeta {
  label: string;
  /** One-line plain-English meaning — surfaced as the hover tooltip on dots + legend chips. */
  description: string;
  /** Tailwind classes for a compact pill (bg + text + ring). */
  pill: string;
  /** Tailwind bg class for a status dot. */
  dot: string;
}

// Dot colors are mutually distinct hues (In Custody indigo vs Orphan pink are
// deliberately far apart). Presentation now flows from the one label registry
// (`src/lib/labels`) — seeded defaults, tenant‑overridable (Phase 2);
// `labels/resolve.test.ts` pins this map byte‑identical to the former literals.
export const OUTBOUND_STATE_META = buildStateMeta('outbound') as Record<OutboundState, OutboundStateMeta>;

/** Fields the table/scan-out view attach to each record after derivation. */
export interface WithOutboundState {
  outboundState: OutboundState;
  /** Has the package physically left (scanned out or carrier has custody)? */
  hasLeft: boolean;
  /** Day-key time: ship_confirmed_at ?? packed_at. */
  effShipTime: string | null;
}
