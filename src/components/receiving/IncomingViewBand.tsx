'use client';

/**
 * The Incoming sub-view toggle: "Incoming POS (n) | Email Triage (n)" pills.
 *
 * Lives in the Incoming sidebar header band (one row right beneath the search
 * bar), following the same nav-pill pattern as every other page
 * (`HorizontalButtonSlider variant="nav" dense`). It owns the `?incview=` URL
 * read+write itself; the right pane reads the same param to pick which sub-view
 * to render. Count hooks share the table's react-query cache keys.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IncomingViewSwitcher, useIncomingEmailCount } from '@/components/receiving/EmailTriagePanel';
import type { IncomingView } from '@/components/receiving/EmailTriagePanel';
import { useIncomingTableTotal } from '@/components/sidebar/receiving/incoming/useIncomingTableTotal';

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

  // Same filtered line total the right-pane table + pagination use (not the
  // summary tile's distinct-PO count) so the pill and header stay in sync.
  const posCount = useIncomingTableTotal();
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
