import type { TimelineItem, TimelineItemBadge, TimelineTone } from './types';
import { substitutionReasonLabel, substitutionReasonTone } from '@/lib/fulfillment/substitution-reasons';

/**
 * One `order_unit_amendments` row — a fulfillment substitution (ordered-vs-
 * fulfilled deviation). Adapts into the shared {@link EventTimeline} so a
 * substitution shows up inline in the order/unit history like any other event,
 * with its ordered→fulfilled delta as the subtitle and the reason + approval
 * state as badges. Never hand-roll a substitution row; feed it through here.
 */
export interface AmendmentTimelineRow {
  id: number;
  created_at: string | null;
  status: 'APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  reason_code: string;
  customer_request_note: string | null;
  original_sku: string | null;
  original_condition: string | null;
  fulfilled_sku: string | null;
  fulfilled_condition: string | null;
  /** The substitute unit's serial, joined for the CopyChip ref. */
  substitute_serial?: string | null;
  /** Actor display name, joined from staff. */
  raised_by_name?: string | null;
}

/** Approval status → dot tone + badge. APPLIED/APPROVED are settled-good. */
const STATUS_TONE: Record<AmendmentTimelineRow['status'], TimelineTone> = {
  APPLIED: 'success',
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
};

const STATUS_LABEL: Record<AmendmentTimelineRow['status'], string> = {
  APPLIED: 'Applied',
  APPROVED: 'Approved',
  PENDING: 'Pending approval',
  REJECTED: 'Rejected',
};

/** "SKU-A · Used A → SKU-B · Used B", omitting blanks; null when nothing differs. */
function deltaSubtitle(row: AmendmentTimelineRow): string | undefined {
  const side = (sku: string | null, cond: string | null): string =>
    [sku?.trim(), cond?.trim()].filter(Boolean).join(' · ') || '—';
  const from = side(row.original_sku, row.original_condition);
  const to = side(row.fulfilled_sku, row.fulfilled_condition);
  const delta = from === '—' && to === '—' ? undefined : `${from} → ${to}`;
  const note = row.customer_request_note?.trim();
  return [delta, note].filter(Boolean).join(' — ') || undefined;
}

/** Map amendment rows → {@link TimelineItem}s for the shared EventTimeline. */
export function amendmentsToTimeline(rows: AmendmentTimelineRow[]): TimelineItem[] {
  return rows.map((r) => {
    const badges: TimelineItemBadge[] = [
      { label: substitutionReasonLabel(r.reason_code), tone: substitutionReasonTone(r.reason_code) },
      { label: STATUS_LABEL[r.status], tone: STATUS_TONE[r.status] },
    ];
    const serial = r.substitute_serial?.trim();
    return {
      id: `amendment-${r.id}`,
      at: r.created_at,
      title: 'Unit substituted',
      tone: STATUS_TONE[r.status],
      subtitle: deltaSubtitle(r),
      ref: serial ? { value: serial, kind: 'serial' } : undefined,
      actor: r.raised_by_name?.trim() || undefined,
      badges,
    };
  });
}
