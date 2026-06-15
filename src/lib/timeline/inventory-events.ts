import type { TimelineItem, TimelineTone } from './types';

/**
 * Normalized inventory_events row, as returned by
 * `readInventorySpine` (src/lib/audit-log/inventory-spine.ts). Kept structurally
 * compatible (a subset) so callers can pass spine rows straight through.
 */
export interface InventoryTimelineRow {
  id: number;
  occurred_at: string | null;
  event_type: string;
  actor_name: string | null;
  serial_number: string | null;
  sku: string | null;
  prev_status: string | null;
  next_status: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * event_type → display. The `inventory_events` spine is the cross-station
 * lifecycle log (RECEIVED, TEST_*, PUTAWAY, …); this is the single curated
 * title/tone map for rendering those through the shared {@link EventTimeline}.
 * Unmapped types fall back to a prettified label + muted tone, so a new engine
 * event type still renders (just without a custom color).
 */
const EVENT_MAP: Record<string, { title: string; tone: TimelineTone }> = {
  RECEIVED: { title: 'Received', tone: 'info' },
  TRIAGED: { title: 'Triaged', tone: 'muted' },
  TEST_START: { title: 'Testing started', tone: 'info' },
  TEST_PASS: { title: 'Tested — Pass', tone: 'success' },
  TEST_FAIL: { title: 'Tested — Fail', tone: 'danger' },
  GRADED: { title: 'Graded', tone: 'info' },
  REPAIR_STARTED: { title: 'Repair started', tone: 'warning' },
  REPAIR_COMPLETED: { title: 'Repair completed', tone: 'success' },
  PUTAWAY: { title: 'Put away', tone: 'muted' },
  MOVED: { title: 'Moved', tone: 'muted' },
  LABELED: { title: 'Labeled', tone: 'info' },
  STAGED: { title: 'Staged', tone: 'muted' },
  HELD: { title: 'Held', tone: 'warning' },
  RELEASED_HOLD: { title: 'Hold released', tone: 'info' },
  ALLOCATED: { title: 'Allocated to order', tone: 'info' },
  RELEASED: { title: 'Allocation released', tone: 'warning' },
  PICKED: { title: 'Picked', tone: 'info' },
  PACKED: { title: 'Packed', tone: 'success' },
  SHIPPED: { title: 'Shipped', tone: 'success' },
  RETURNED: { title: 'Returned', tone: 'warning' },
  SCRAPPED: { title: 'Scrapped', tone: 'danger' },
  ADJUSTED: { title: 'Adjusted', tone: 'muted' },
  LISTED: { title: 'Listed', tone: 'info' },
  NOTE: { title: 'Note', tone: 'muted' },
};

function pretty(eventType: string): string {
  const s = eventType.replace(/[._-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Map `inventory_events` spine rows → {@link TimelineItem}s for the shared
 * `EventTimeline`. The secondary line carries the unit (serial/SKU) and the
 * prev→next status transition when present, so a verdict reads
 * "Tested — Pass · IN_TEST → TESTED · SERIAL123".
 */
export function inventoryEventsToTimeline(rows: InventoryTimelineRow[]): TimelineItem[] {
  return rows.map((r) => {
    const mapped = EVENT_MAP[r.event_type];
    const title = mapped?.title ?? pretty(r.event_type);
    const tone = mapped?.tone ?? 'muted';

    const subtitle =
      r.prev_status && r.next_status && r.prev_status !== r.next_status
        ? `${r.prev_status} → ${r.next_status}`
        : undefined;
    // The unit identifier becomes a last-4 CopyChip (serial = emerald barcode,
    // sku = yellow pencil), matching how ids render everywhere else.
    let ref: TimelineItem['ref'];
    if (r.serial_number) ref = { value: r.serial_number, kind: 'serial' };
    else if (r.sku) ref = { value: r.sku, kind: 'sku' };

    return {
      id: `inv:${r.id}`,
      at: r.occurred_at,
      title,
      tone,
      subtitle,
      ref,
      actor: r.actor_name ?? undefined,
    };
  });
}
