'use client';

import { TimelineSection } from '@/components/ui/TimelineSection';
import { amendmentsToTimeline, type AmendmentTimelineRow } from '@/lib/timeline';

/**
 * The order's substitutions, rendered through the shared EventTimeline (via
 * TimelineSection — header + skeleton + empty for free). Drop into the testing /
 * packing card or the order history pane. Feed it the rows from
 * GET /api/orders/[id]/amendments; the adapter owns the row→TimelineItem mapping.
 */
export interface OrderAmendmentsSectionProps {
  rows: AmendmentTimelineRow[];
  loading?: boolean;
  title?: string;
  density?: 'comfortable' | 'compact';
}

export function OrderAmendmentsSection({
  rows,
  loading = false,
  title = 'Substitutions',
  density = 'compact',
}: OrderAmendmentsSectionProps) {
  const pending = rows.filter((r) => r.status === 'PENDING').length;
  return (
    <TimelineSection
      title={title}
      items={amendmentsToTimeline(rows)}
      loading={loading}
      density={density}
      emptyMessage="No substitutions on this order."
      headerRight={
        pending > 0 ? (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-amber-700 ring-1 ring-inset ring-amber-200">
            {pending} pending
          </span>
        ) : undefined
      }
    />
  );
}
