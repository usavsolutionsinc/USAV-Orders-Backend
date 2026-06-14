import type { TimelineItem, TimelineItemBadge, TimelineTone } from './types';

/**
 * Carrier tracking event shape (subset of `shipment_tracking_events` the
 * incoming details panel fetches). Kept local so the adapter is self-contained.
 */
export interface CarrierEvent {
  id: number;
  event_occurred_at: string | null;
  normalized_status_category: string;
  external_status_label: string | null;
  external_status_description: string | null;
  event_city: string | null;
  event_state: string | null;
  exception_description: string | null;
  signed_by: string | null;
}

// Tone for a carrier event's dot, keyed on the normalized status so the operator
// can eyeball the trail — delivery (success), exception (danger), out-for-delivery
// (warning), label/pre-transit (muted), in-transit default (info).
function carrierTone(category: string | null | undefined): TimelineTone {
  const c = (category || '').toLowerCase();
  if (c.includes('deliver') && !c.includes('out')) return 'success';
  if (c.includes('exception') || c.includes('fail') || c.includes('return')) return 'danger';
  if (c.includes('out_for_delivery') || c.includes('ofd')) return 'warning';
  if (c.includes('pre_transit') || c.includes('label') || c.includes('created') || c.includes('unknown'))
    return 'muted';
  return 'info';
}

function prettyStatus(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Map carrier tracking events → timeline items. Title prefers the carrier's
 * human description, falls back to a readable label (>2 chars — single-letter
 * carrier codes like UPS "D"/"I"/"X" are never shown), then the prettified
 * normalized category.
 */
export function carrierEventsToTimeline(events: CarrierEvent[]): TimelineItem[] {
  return events.map((e) => {
    const location = e.event_city
      ? `${e.event_city}${e.event_state ? ', ' + e.event_state : ''}`
      : undefined;
    const rawLabel = (e.external_status_label || '').trim();
    const title =
      e.external_status_description?.trim() ||
      (rawLabel.length > 2 ? rawLabel : '') ||
      prettyStatus(e.normalized_status_category);

    const badges: TimelineItemBadge[] = [];
    if (e.signed_by) badges.push({ label: `Signed by ${e.signed_by}`, tone: 'success' });
    if (e.exception_description) badges.push({ label: e.exception_description, tone: 'danger' });

    return {
      id: e.id,
      at: e.event_occurred_at,
      title,
      tone: carrierTone(e.normalized_status_category),
      subtitle: location,
      badges: badges.length ? badges : undefined,
    };
  });
}
