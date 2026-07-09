'use client';

/**
 * Operations ▸ Signals — the right-pane body for `?mode=signals`.
 *
 * Timeline (default) and Browse are sub-views (`?signalsView=browse`); the
 * sub-view rail lives in OperationsSidebarPanel. Search is registered with the
 * global header via {@link usePageHeaderSearch}.
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePageHeaderSearch } from '@/hooks/usePageHeader';
import { SignalsHistoryWorkspace } from './SignalsHistoryWorkspace';
import { SignalsBrowseWorkspace } from './SignalsBrowseWorkspace';
import { parseSignalsView, replaceOperationsSignalsUrl } from './signals-url';

export function SignalsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signalsView = parseSignalsView(searchParams.get('signalsView'));
  const q = searchParams.get('q') ?? '';

  const setQ = useCallback(
    (value: string) => {
      replaceOperationsSignalsUrl(router, searchParams, (sp) => {
        const trimmed = value.trim();
        if (trimmed) sp.set('q', trimmed);
        else sp.delete('q');
      });
    },
    [router, searchParams],
  );

  usePageHeaderSearch(
    {
      value: q,
      onChange: setQ,
      onClear: () => setQ(''),
      placeholder: 'Search signal notes…',
      debounceMs: 250,
    },
    [q, setQ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {signalsView === 'browse' ? <SignalsBrowseWorkspace /> : <SignalsHistoryWorkspace />}
      </div>
    </div>
  );
}
