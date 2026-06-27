'use client';

/**
 * The Incoming sub-view toggle: "Incoming POS (n) | Email Triage (n)" pills.
 *
 * Lives in the Incoming sidebar's `headerRows` slot (one row right beneath the
 * search bar), following the same sub-tab pattern as every other page
 * (`HorizontalButtonSlider variant="nav" dense` — cf. Products/Repair). It owns
 * the `?incview=` URL read+write itself, so the sidebar can drop it in with no
 * prop plumbing, and the right pane reads the same param to pick which sub-view
 * to render. Selection in the URL = deep-linkable + reload-safe.
 *
 * The count hooks (`useIncomingSummary`, `useIncomingEmailCount`) share the
 * sidebar's existing react-query cache keys, so the pills add no extra network
 * traffic; mounting them only in Incoming mode keeps that polling scoped.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IncomingViewSwitcher, useIncomingEmailCount } from '@/components/receiving/EmailTriagePanel';
import type { IncomingView } from '@/components/receiving/EmailTriagePanel';
import { useIncomingSummary } from '@/components/sidebar/receiving/incoming/useIncomingSummary';

export function IncomingViewBand() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const value: IncomingView = searchParams.get('incview') === 'email' ? 'email' : 'pos';

  const onChange = useCallback(
    (next: IncomingView) => {
      const params = new URLSearchParams(searchParams.toString());
      // `pos` is the default — drop it from the URL to keep deep links clean.
      if (next === 'pos') params.delete('incview');
      else params.set('incview', next);
      router.replace(`/receiving?${params.toString()}`);
    },
    [router, searchParams],
  );

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
