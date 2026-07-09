import type { TimelineItem, TimelineGroupKey } from './types';
import { TIMELINE_OTHER_BAND_KEY } from './types';
import {
  inventoryEventsToTimeline,
  stationActivityToTimeline,
  orderAuditToTimeline,
  carrierEventsToTimeline,
  warrantyEventsToTimeline,
  collapseTimeline,
  type InventoryTimelineRow,
  type StationActivityRow,
  type OrderAuditRow,
  type CarrierEvent,
  type WarrantyEventRow,
} from './index';

/**
 * Client-side merge for the Master Operations Journey. The `/api/operations/journey`
 * endpoint returns events bucketed by `source` with a `raw` payload shaped to each
 * source's existing `*ToTimeline` adapter — so this dispatches each bucket through
 * the SAME adapter (no new label/tone mapping), then sorts newest-first and folds
 * adjacent duplicates via `collapseTimeline`. The grouping keys the server resolved
 * per row drive the per-entity journey bands (order / serial / tracking) through
 * `EventTimeline`'s `groupKeyOf`.
 *
 * These are the client mirror of the server wire types (see
 * `src/lib/operations/journey.ts`) — kept structurally local so this module never
 * imports the `server-only` domain module.
 */

export type JourneySource = 'sal' | 'inventory' | 'audit' | 'carrier' | 'warranty';
export type JourneyDimension = 'order' | 'serial' | 'tracking';

export interface JourneyGroupKeys {
  orderId: number | null;
  orderNumber: string | null;
  serialNumber: string | null;
  trackingNumber: string | null;
  station: string | null;
}

export interface JourneyEvent {
  source: JourneySource;
  id: string;
  at: string | null;
  group: JourneyGroupKeys;
  raw: unknown;
}

export interface MergedJourney {
  items: TimelineItem[];
  /** item.id → its resolved grouping keys (object-collision-free via namespaced id). */
  groupOf: Map<string, JourneyGroupKeys>;
}

/**
 * Dispatch each source bucket through its adapter, namespace audit/carrier ids to
 * match the server (so the id→group map can't collide), sort newest-first, and
 * collapse adjacent dupes (which preserves the survivor's id).
 */
export function mergeJourney(events: JourneyEvent[]): MergedJourney {
  const groupOf = new Map<string, JourneyGroupKeys>();
  const sal: StationActivityRow[] = [];
  const inventory: InventoryTimelineRow[] = [];
  const audit: OrderAuditRow[] = [];
  const carrier: CarrierEvent[] = [];
  const warranty: WarrantyEventRow[] = [];

  for (const ev of events) {
    groupOf.set(ev.id, ev.group);
    switch (ev.source) {
      case 'sal':
        sal.push(ev.raw as StationActivityRow);
        break;
      case 'inventory':
        inventory.push(ev.raw as InventoryTimelineRow);
        break;
      case 'audit':
        audit.push(ev.raw as OrderAuditRow);
        break;
      case 'carrier':
        carrier.push(ev.raw as CarrierEvent);
        break;
      case 'warranty':
        warranty.push(ev.raw as WarrantyEventRow);
        break;
    }
  }

  // sal / inv / warranty adapters already namespace their ids; audit & carrier
  // adapters emit the raw numeric id, so re-namespace to match the server's
  // `audit:`/`carrier:` ids (and stay collision-free in groupOf).
  const merged: TimelineItem[] = [
    ...stationActivityToTimeline(sal),
    ...inventoryEventsToTimeline(inventory),
    ...orderAuditToTimeline(audit).map((it) => ({ ...it, id: `audit:${it.id}` })),
    ...carrierEventsToTimeline(carrier).map((it) => ({ ...it, id: `carrier:${it.id}` })),
    ...warrantyEventsToTimeline(warranty),
  ];

  merged.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return String(b.id).localeCompare(String(a.id));
  });

  return { items: collapseTimeline(merged), groupOf };
}

/**
 * Ship/return round-trip counts for a merged journey (§1 success metric of the
 * returns-unification plan: "how many times it has been returned and shipped
 * out"). Two counts, not one combined "trips" figure — a unit can ship more
 * times than it's returned (the latest trip may still be out), so pairing
 * them would either be wrong or need an arbitrary tie-break; two counts stay
 * exactly as literal as the ask.
 *
 * Keyed on `TimelineItem.sourceEventType` (only `inventoryEventsToTimeline`
 * sets it) — never the display `title` string, which is free to change
 * without warning. A unit with no ship/return history yields {0, 0}.
 */
export function countRoundTrips(items: TimelineItem[]): { shippedCount: number; returnedCount: number } {
  let shippedCount = 0;
  let returnedCount = 0;
  for (const item of items) {
    if (item.sourceEventType === 'SHIPPED') shippedCount += 1;
    else if (item.sourceEventType === 'RETURNED') returnedCount += 1;
  }
  return { shippedCount, returnedCount };
}

/**
 * Build the `groupKeyOf` selector for {@link EventTimeline} that buckets each row
 * into its order / serial / tracking journey band. Rows missing the active
 * dimension's key are forced into the trailing "Other events" band rather than
 * fragmenting into incidental ref bands.
 */
export function journeyKeyOf(
  dim: JourneyDimension,
  groupOf: Map<string, JourneyGroupKeys>,
): (item: TimelineItem) => TimelineGroupKey | null {
  const other: TimelineGroupKey = { key: TIMELINE_OTHER_BAND_KEY, label: 'Other events' };
  return (item) => {
    const g = groupOf.get(String(item.id));
    if (!g) return other;
    if (dim === 'order') {
      if (g.orderId == null) return other;
      return {
        key: `order:${g.orderId}`,
        label: g.orderNumber ?? `Order ${g.orderId}`,
        ref: g.orderNumber ? { value: g.orderNumber, kind: 'id' } : undefined,
      };
    }
    if (dim === 'serial') {
      if (!g.serialNumber) return other;
      return { key: `serial:${g.serialNumber}`, label: g.serialNumber, ref: { value: g.serialNumber, kind: 'serial' } };
    }
    // tracking
    if (!g.trackingNumber) return other;
    return {
      key: `tracking:${g.trackingNumber}`,
      label: g.trackingNumber,
      ref: { value: g.trackingNumber, kind: 'tracking' },
    };
  };
}
