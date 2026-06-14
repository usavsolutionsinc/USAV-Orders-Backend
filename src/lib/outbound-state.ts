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

export type OutboundState =
  | 'PACKED_STAGED' // packed, sitting in staging, not yet scanned out
  | 'SCANNED_OUT' // dock scan recorded, carrier hasn't reported custody yet
  | 'IN_CUSTODY' // carrier accepted / in transit / out for delivery
  | 'DELIVERED' // terminal delivered
  | 'EXCEPTION' // carrier exception or stalled (no movement)
  | 'PROCESS_GAP' // scanned out but no pack record — backfill / coach
  | 'ORPHAN'; // carrier took custody but it was never scanned out internally

/** Carrier status categories that mean the carrier physically has the package. */
const CUSTODY_CATEGORIES = new Set(['ACCEPTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED']);

export interface OutboundStateInput {
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

/** Carrier has physical custody (accepted or further along). */
export function carrierHasCustody(input: OutboundStateInput): boolean {
  const cat = String(input.latestStatusCategory ?? '').toUpperCase();
  return CUSTODY_CATEGORIES.has(cat);
}

/**
 * Has the package left the building? Either we scanned it out, or the carrier
 * already has it. Used to partition the staging table from the shipped-out table.
 */
export function hasLeftWarehouse(input: OutboundStateInput): boolean {
  return Boolean(input.shipConfirmedAt) || carrierHasCustody(input);
}

export function deriveOutboundState(input: OutboundStateInput): OutboundState {
  const cat = String(input.latestStatusCategory ?? '').toUpperCase();
  const hasPack = Boolean(input.packedAt);
  const hasShipOut = Boolean(input.shipConfirmedAt);
  const delivered = cat === 'DELIVERED' || (input.isTerminal === true && cat !== 'RETURNED');
  const custody = carrierHasCustody(input);

  // Scanned out with no pack record at all → a process gap worth surfacing.
  if (hasShipOut && !hasPack) return 'PROCESS_GAP';
  if (delivered) return 'DELIVERED';
  if (input.hasException || input.stalled) return 'EXCEPTION';
  if (custody && hasShipOut) return 'IN_CUSTODY';
  // Carrier has it, but it was never scanned out internally — left outside the flow.
  if (custody && !hasShipOut) return 'ORPHAN';
  if (hasShipOut) return 'SCANNED_OUT';
  return 'PACKED_STAGED';
}

export interface OutboundStateMeta {
  label: string;
  /** Tailwind classes for a compact pill (bg + text + ring). */
  pill: string;
  /** Tailwind bg class for a status dot. */
  dot: string;
}

export const OUTBOUND_STATE_META: Record<OutboundState, OutboundStateMeta> = {
  PACKED_STAGED: { label: 'In Staging', pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-400' },
  SCANNED_OUT: { label: 'Scanned Out', pill: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  IN_CUSTODY: { label: 'In Custody', pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200', dot: 'bg-indigo-500' },
  DELIVERED: { label: 'Delivered', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  EXCEPTION: { label: 'Exception', pill: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  PROCESS_GAP: { label: 'Process Gap', pill: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  ORPHAN: { label: 'Orphan', pill: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200', dot: 'bg-fuchsia-500' },
};

/** Fields the table/scan-out view attach to each record after derivation. */
export interface WithOutboundState {
  outboundState: OutboundState;
  /** Has the package physically left (scanned out or carrier has custody)? */
  hasLeft: boolean;
  /** Day-key time: ship_confirmed_at ?? packed_at. */
  effShipTime: string | null;
}

/** The "effective ship time" used to file a package under the day it left, not the day it was packed. */
export function effectiveShipTime(input: {
  shipConfirmedAt?: string | null;
  packedAt?: string | null;
}): string | null {
  return input.shipConfirmedAt || input.packedAt || null;
}
