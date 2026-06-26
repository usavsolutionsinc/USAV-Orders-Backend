'use client';

/**
 * The Incoming right-pane sub-view toggle band: "Incoming POS (n) | Email Triage (n)".
 *
 * Split into its own component so the count hooks (`useIncomingSummary`,
 * `useIncomingEmailCount`) mount ONLY in Incoming mode — they poll, and we don't
 * want that polling running on the History / Unbox / Receiving panes. Both hooks
 * share the sidebar's existing react-query cache keys, so the band adds no extra
 * network traffic.
 *
 * Selection of the view is URL state (`?incview=`), owned by the parent
 * (`ReceivingDashboard`) — this band is dumb display + an `onChange` callback.
 */

import { IncomingViewSwitcher, useIncomingEmailCount } from '@/components/receiving/EmailTriagePanel';
import type { IncomingView } from '@/components/receiving/EmailTriagePanel';
import { useIncomingSummary } from '@/components/sidebar/receiving/incoming/useIncomingSummary';

interface IncomingViewBandProps {
  value: IncomingView;
  onChange: (next: IncomingView) => void;
}

export function IncomingViewBand({ value, onChange }: IncomingViewBandProps) {
  // `issued` = open incoming POs Zoho says are expected but not yet received —
  // the "Incoming POS" backlog the table shows.
  const posCount = useIncomingSummary()?.issued;
  const emailCount = useIncomingEmailCount();

  return (
    <IncomingViewSwitcher
      value={value}
      onChange={onChange}
      posCount={posCount}
      emailCount={emailCount}
    />
  );
}
