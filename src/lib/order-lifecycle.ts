/**
 * Order lifecycle — the SINGLE canonical projection of an order's pre‑dock
 * (sold → label → test → pack → stage) lifecycle stage.
 *
 * **Why this module exists.** The order/fulfillment lane shown on the
 * Unshipped + testing boards used to be re‑derived in three unrelated places
 * (`deriveFulfillmentState` in a lib, a `has_tech_scan` SQL projection in the
 * orders route, and lane/icon literals inlined in the board component). Three
 * spines had to agree by coincidence for a row to change lane. This module is
 * the one place the **precedence rules** and the **lane vocabulary** live, so
 * every board, count, and route reads the same projection.
 *
 * This is step W2 of `docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md`:
 * collapse the parallel read‑models onto one projection. The rule set is
 * declared as **data** (`UNSHIPPED_LIFECYCLE_RULES`) so it can later be sourced
 * from `workflow_nodes.config` / a decision node and edited in Studio (W4),
 * with `serial_units`/`item_workflow_state` taps feeding the signals (W5).
 *
 * Pure + isomorphic (no React, no DOM, no Date.now): safe on client and server.
 * Presentation (label/dot/pill colors) stays in `unshipped-state.ts`'s
 * `*_STATE_META`; this module is logic + vocabulary only.
 */

/** The full pre‑dock pipeline stage vocabulary. */
export type OrderLifecycleStage =
  | 'AWAITING_LABEL' // sold, no tracking/label yet (shipment_id is null)
  | 'PENDING' // labeled, waiting for test/pack
  | 'TESTED' // passed tech scan — ready to pack
  | 'PACKED_STAGED' // packed + staged, awaiting dock scan‑out (shared seam state)
  | 'BLOCKED'; // out of stock / can't fulfill — needs attention

/** The narrowed lane vocabulary the Dashboard · Unshipped board renders. */
export type FulfillmentLane = 'PENDING' | 'TESTED' | 'BLOCKED';

/** The canonical lifecycle signals — the inputs every derivation reads. */
export interface OrderLifecycleSignals {
  /** orders.shipment_id — null means no tracking/label has been attached yet. */
  shipmentId?: number | string | null;
  /** A tech scan exists (order tested). */
  hasTechScan?: boolean | null;
  /** PACK event timestamp (pack completed, not merely a packer assigned). */
  packedAt?: string | null;
  /** orders.out_of_stock — a non‑empty string means the line is flagged blocked. */
  outOfStock?: string | null;
}

// ─── Shared predicates (one definition, reused by every evaluator) ──────────────
/** A non‑empty out_of_stock string flags the line as blocked. */
export function isOutOfStock(s: OrderLifecycleSignals): boolean {
  return String(s.outOfStock ?? '').trim() !== '';
}
/** A label/tracking is attached (shipment_id present). */
export function hasLabel(s: OrderLifecycleSignals): boolean {
  return s.shipmentId != null && String(s.shipmentId) !== '';
}

/**
 * Ordered, first‑match‑wins rule set — the SINGLE place pre‑dock precedence
 * lives. Declared as data (`id` + `stage` + a typed predicate) so the
 * precedence is inspectable and portable into Studio config / a decision node
 * (W4) without rewriting consumers. Precedence: a completed PACK wins outright
 * (the stock question is moot once it is physically staged), then exception‑
 * first within the not‑yet‑packed stages.
 */
interface OrderLifecycleRule {
  id: string;
  stage: OrderLifecycleStage;
  test: (s: OrderLifecycleSignals) => boolean;
}

export const UNSHIPPED_LIFECYCLE_RULES: readonly OrderLifecycleRule[] = [
  { id: 'packed_staged', stage: 'PACKED_STAGED', test: (s) => Boolean(s.packedAt) },
  { id: 'out_of_stock', stage: 'BLOCKED', test: isOutOfStock },
  { id: 'tech_passed', stage: 'TESTED', test: (s) => Boolean(s.hasTechScan) },
  { id: 'labeled', stage: 'PENDING', test: hasLabel },
];

/** Stage when no rule matches: sold but not yet labeled. */
export const DEFAULT_LIFECYCLE_STAGE: OrderLifecycleStage = 'AWAITING_LABEL';

/** Resolve the full pre‑dock pipeline stage from the canonical signals. */
export function resolveOrderLifecycleStage(signals: OrderLifecycleSignals): OrderLifecycleStage {
  for (const rule of UNSHIPPED_LIFECYCLE_RULES) {
    if (rule.test(signals)) return rule.stage;
  }
  return DEFAULT_LIFECYCLE_STAGE;
}

/**
 * Resolve the fulfillment LANE for orders already in the labeled‑not‑packed
 * scope (Dashboard · Unshipped board). This scope never carries a PACK event,
 * so the lane is exception‑first then tested‑vs‑pending — using the same shared
 * predicates as the full stage so the precedence can never drift between the
 * two. (Behaviourally identical to the former `deriveFulfillmentState`.)
 */
export function resolveFulfillmentLane(signals: OrderLifecycleSignals): FulfillmentLane {
  if (isOutOfStock(signals)) return 'BLOCKED';
  if (signals.hasTechScan) return 'TESTED';
  return 'PENDING';
}

// ─── Board descriptor (lane order + icon binding, as data — no React) ───────────
/** Icon binding key; the board maps this to a concrete icon component. */
export type FulfillmentLaneIconKey = 'clock' | 'check' | 'alert';

interface FulfillmentLaneDescriptor {
  id: FulfillmentLane;
  /** Which structural icon sits next to the lane title. */
  iconKey: FulfillmentLaneIconKey;
  /** Lane header icon color (icon only; the status dot keeps the meta hue). */
  iconClass: string;
}

/**
 * Lane order (top → bottom = progress; Blocked/exception last) + per‑lane icon
 * binding for the Unshipped board. Was three inlined component literals
 * (`SHELF_ORDER`, `STATE_ICON`, `STATE_ICON_CLASS`); now one descriptor list so
 * the lane set is data the board renders, not logic it owns.
 */
export const FULFILLMENT_BOARD_LANES: readonly FulfillmentLaneDescriptor[] = [
  { id: 'PENDING', iconKey: 'clock', iconClass: 'text-yellow-500' },
  { id: 'TESTED', iconKey: 'check', iconClass: 'text-green-500' },
  { id: 'BLOCKED', iconKey: 'alert', iconClass: 'text-red-500' },
];

// ════════════════════════════════════════════════════════════════════════════
// POST‑DOCK (outbound) lifecycle — pack → leave‑the‑building → carrier custody →
// delivered. The mirror of the pre‑dock half above; the two models meet at the
// shared `PACKED_STAGED` seam (terminal unshipped / initial outbound). Folded
// in here (was `outbound-state.ts`) so ALL order lifecycle display derivation
// lives in one projection; `outbound-state.ts` keeps only the color META and
// delegates its derivation here. Same W2 consolidation as the pre‑dock half.
// ════════════════════════════════════════════════════════════════════════════

export type OutboundStage =
  | 'PACKED_STAGED' // packed, sitting in staging, not yet scanned out
  | 'SCANNED_OUT' // dock scan recorded, carrier hasn't reported custody yet
  | 'IN_CUSTODY' // carrier accepted / in transit / out for delivery
  | 'DELIVERED' // terminal delivered
  | 'EXCEPTION' // carrier exception or stalled (no movement)
  | 'PROCESS_GAP' // scanned out but no pack record — backfill / coach
  | 'ORPHAN'; // carrier took custody but it was never scanned out internally

/** The post‑dock signals every outbound derivation reads. */
export interface OutboundSignals {
  /** PACK event present (packer scanned it). */
  packedAt?: string | null;
  /** SHIP_CONFIRM event present (scanned out at the dock). */
  shipConfirmedAt?: string | null;
  /** shipping_tracking_numbers.latest_status_category. */
  latestStatusCategory?: string | null;
  /** shipping_tracking_numbers.is_terminal. */
  isTerminal?: boolean | null;
  /** shipping_tracking_numbers.has_exception. */
  hasException?: boolean | null;
  /** Caller-computed `isStalled(...)` result (kept out of here so this stays pure). */
  stalled?: boolean | null;
}

/**
 * The full normalized carrier status-category vocabulary
 * (`shipping_tracking_numbers.latest_status_category`). Single SoT for the
 * 8 categories — the orders route's status-category filter validates against
 * this instead of an inline literal tuple.
 */
export const SHIPMENT_STATUS_CATEGORIES = [
  'LABEL_CREATED',
  'ACCEPTED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
  'RETURNED',
  'UNKNOWN',
] as const;

/**
 * Carrier status categories that mean the carrier physically has the package.
 * Single SoT for "is the carrier holding it" — the one vocabulary every
 * custody/shipped predicate reads.
 */
export const CUSTODY_CATEGORIES: ReadonlySet<string> = new Set([
  'ACCEPTED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURNED',
]);

/** Carrier has physical custody (accepted or further along). */
export function carrierHasCustody(input: OutboundSignals): boolean {
  return CUSTODY_CATEGORIES.has(String(input.latestStatusCategory ?? '').toUpperCase());
}

/**
 * Has the package left the building? Either we scanned it out, or the carrier
 * already has it. Used to partition the staging table from the shipped-out table.
 */
export function hasLeftWarehouse(input: OutboundSignals): boolean {
  return Boolean(input.shipConfirmedAt) || carrierHasCustody(input);
}

/** Resolve the post‑dock outbound stage from the carrier + scan signals. */
export function resolveOutboundStage(input: OutboundSignals): OutboundStage {
  const cat = String(input.latestStatusCategory ?? '').toUpperCase();
  const hasPack = Boolean(input.packedAt);
  const hasShipOut = Boolean(input.shipConfirmedAt);
  const delivered = cat === 'DELIVERED' || (input.isTerminal === true && cat !== 'RETURNED');
  const custody = carrierHasCustody(input);

  // Delivered is terminal and always the last word — it overrides scanned-out,
  // process-gap, exception, everything.
  if (delivered) return 'DELIVERED';
  // Scanned out with no pack record at all → a process gap worth surfacing.
  if (hasShipOut && !hasPack) return 'PROCESS_GAP';
  if (input.hasException || input.stalled) return 'EXCEPTION';
  if (custody && hasShipOut) return 'IN_CUSTODY';
  // Carrier has it, but it was never scanned out internally — left outside the flow.
  if (custody && !hasShipOut) return 'ORPHAN';
  if (hasShipOut) return 'SCANNED_OUT';
  return 'PACKED_STAGED';
}

/** The "effective ship time" used to file a package under the day it left, not the day it was packed. */
export function effectiveShipTime(input: {
  shipConfirmedAt?: string | null;
  packedAt?: string | null;
}): string | null {
  return input.shipConfirmedAt || input.packedAt || null;
}

/** Icon binding key for an outbound lane; the board maps it to a concrete glyph. */
export type OutboundLaneIconKey =
  | 'staged'
  | 'scanned_out'
  | 'in_custody'
  | 'delivered'
  | 'exception'
  | 'process_gap'
  | 'orphan';

interface OutboundLaneDescriptor {
  id: OutboundStage;
  iconKey: OutboundLaneIconKey;
}

/**
 * Shipped board lane order (top → bottom = outbound timeline; the exception
 * buckets trail the happy path) + per‑lane icon binding, as data. Was two
 * inlined component literals (`SHIPPED_LANE_ORDER`, `OUTBOUND_STATE_ICON`);
 * label/dot/description still come from the `OUTBOUND_STATE_META` color SoT.
 */
export const OUTBOUND_BOARD_LANES: readonly OutboundLaneDescriptor[] = [
  { id: 'PACKED_STAGED', iconKey: 'staged' },
  { id: 'SCANNED_OUT', iconKey: 'scanned_out' },
  { id: 'IN_CUSTODY', iconKey: 'in_custody' },
  { id: 'DELIVERED', iconKey: 'delivered' },
  { id: 'EXCEPTION', iconKey: 'exception' },
  { id: 'PROCESS_GAP', iconKey: 'process_gap' },
  { id: 'ORPHAN', iconKey: 'orphan' },
];
