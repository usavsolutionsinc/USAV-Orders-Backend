import type { TimelineItem, TimelineTone } from './types';

/**
 * One warranty-claim event row (`WarrantyClaimEventRow` in
 * `src/lib/warranty/types.ts`), as returned by the claim detail query. Kept
 * structurally local so the adapter doesn't pull the whole warranty types graph.
 */
export interface WarrantyEventRow {
  id: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string | null;
  actorName?: string | null;
}

/**
 * event_type → display for warranty-claim lifecycle events. Unmapped types fall
 * back to a prettified label + muted tone so a new event still renders.
 */
const EVENT_MAP: Record<string, { title: string; tone: TimelineTone }> = {
  CREATED: { title: 'Claim opened', tone: 'info' },
  STATUS_CHANGED: { title: 'Status changed', tone: 'muted' },
  NOTE_ADDED: { title: 'Note added', tone: 'muted' },
  TICKET_LINKED: { title: 'Ticket linked', tone: 'info' },
  QUOTE_SENT: { title: 'Quote sent', tone: 'info' },
  QUOTE_ACCEPTED: { title: 'Quote accepted', tone: 'success' },
  QUOTE_DECLINED: { title: 'Quote declined', tone: 'warning' },
  REPAIR_STARTED: { title: 'Repair started', tone: 'warning' },
  REPAIR_COMPLETED: { title: 'Repair completed', tone: 'success' },
  RESOLVED: { title: 'Resolved', tone: 'success' },
  CLOSED: { title: 'Closed', tone: 'muted' },
};

function pretty(eventType: string): string {
  const s = eventType.replace(/[._-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Map warranty-claim events → {@link TimelineItem}s for the shared
 * `EventTimeline`. A status transition (`from → to`) becomes the subtitle, so a
 * row reads "Status changed · OPEN → IN_REPAIR".
 */
export function warrantyEventsToTimeline(rows: WarrantyEventRow[]): TimelineItem[] {
  return rows.map((r) => {
    const mapped = EVENT_MAP[r.eventType];
    const title = mapped?.title ?? pretty(r.eventType);
    const tone = mapped?.tone ?? 'muted';
    const subtitle =
      r.toStatus && r.fromStatus !== r.toStatus
        ? `${r.fromStatus ?? '—'} → ${r.toStatus}`
        : r.toStatus
          ? r.toStatus
          : undefined;
    return {
      id: `warranty:${r.id}`,
      at: r.createdAt,
      title,
      tone,
      subtitle,
      actor: r.actorName ?? undefined,
    };
  });
}
