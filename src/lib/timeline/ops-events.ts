import type { TimelineItem, TimelineTone } from './types';

/**
 * One `ops_events` row (src/lib/ops-events.ts / migration 2026-06-30) — the
 * newest polymorphic "SAL-style" event spine, used today for stable
 * first/last-scan and unboxed/received ordering on the receiving rail.
 * `actor_name` is optional: no existing reader resolves it yet (no query
 * currently joins `staff`), so a caller that only has the raw
 * `actor_staff_id` can omit it rather than fake a value.
 */
export interface OpsEventRow {
  id: number;
  occurred_at: string | null;
  event_type: string;
  entity_type: string;
  entity_id: number;
  actor_name?: string | null;
}

/**
 * event_type → display. Covers the 3 event types currently written
 * (src/lib/receiving/record-scan.ts, unbox-scan-opened.ts,
 * src/app/api/receiving/mark-received-po/route.ts). Unmapped types fall back
 * to a prettified label + muted tone, so a new ops_events writer still
 * renders without a matching row here first.
 */
const EVENT_MAP: Record<string, { title: string; tone: TimelineTone }> = {
  TRACKING_SCANNED: { title: 'Tracking scanned', tone: 'info' },
  UNBOX_SCAN_OPENED: { title: 'Unbox scan opened', tone: 'info' },
  UNBOX_CONFIRMED: { title: 'Unbox confirmed', tone: 'success' },
};

function pretty(eventType: string): string {
  const s = eventType.replace(/[._-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Map `ops_events` rows → {@link TimelineItem}s for the shared `EventTimeline`.
 * Closes Gap #11 of the returns-unification plan (§6 row 11): this spine had
 * no `*ToTimeline` adapter and was invisible to every existing history
 * surface. Not yet wired into `readJourneyEntity`'s spine list (§9 Stage 3) —
 * its current writers are all `entity_type: 'receiving'` (carton-level),
 * which doesn't fit the serial-scoped journey without a receiving-id anchor
 * path readJourneyEntity doesn't have today; wiring a new spine in is a
 * separate, larger change than adding the adapter itself. The entity_id is
 * kept out of `ref` for the same reason — a bare carton id isn't one of
 * EventTimeline's known CopyChip kinds (tracking/serial/fnsku/id/sku).
 */
export function opsEventsToTimeline(rows: OpsEventRow[]): TimelineItem[] {
  return rows.map((r) => {
    const mapped = EVENT_MAP[r.event_type];
    const title = mapped?.title ?? pretty(r.event_type);
    const tone = mapped?.tone ?? 'muted';

    return {
      id: `ops:${r.id}`,
      at: r.occurred_at,
      title,
      tone,
      actor: r.actor_name ?? undefined,
      sourceEventType: r.event_type,
    };
  });
}
