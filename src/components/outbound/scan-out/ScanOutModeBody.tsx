'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { ScanOutStationBar } from '@/components/outbound/scan-out/ScanOutStationBar';
import { OutboundDockStatusLegend } from '@/components/outbound/scan-out/OutboundDockStatusLegend';
import { stagedOrdersQuery } from '@/lib/queries/outbound-queries';
import { useOutboundUrlState } from '@/hooks/useOutboundUrlState';

/** Scan-out mode sidebar — filter, staging count, and dock scan bar (list lives in the right pane). */
export function ScanOutModeBody() {
  const { q, setQ } = useOutboundUrlState();
  const [searchInput, setSearchInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stagedQuery = useQuery(stagedOrdersQuery({ searchQuery: q }));
  const queueCount = stagedQuery.data?.length ?? 0;

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const commitSearch = useCallback(
    (value: string) => setQ(value),
    [setQ],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => commitSearch(value), 300);
    },
    [commitSearch],
  );

  return (
    <SidebarShell
      search={{
        value: searchInput,
        onChange: handleInputChange,
        onSearch: commitSearch,
        onClear: () => {
          setSearchInput('');
          commitSearch('');
        },
        inputRef,
        placeholder: 'Filter staged packages…',
        variant: 'blue',
      }}
      headerBelow={
        <div className={`${SIDEBAR_GUTTER} space-y-2 pb-1`}>
          <OutboundDockStatusLegend />
          <p className="text-eyebrow font-bold uppercase tracking-widest text-emerald-600">
            {queueCount} package{queueCount === 1 ? '' : 's'} ready to scan out
          </p>
        </div>
      }
      bodyClassName="flex min-h-0 flex-1 flex-col"
      footer={
        <div className={`${SIDEBAR_GUTTER} border-t border-border-hairline bg-surface-card pb-4 pt-3`}>
          <ScanOutStationBar autoFocus />
        </div>
      }
    >
      <div className={`${SIDEBAR_GUTTER} text-sm text-text-soft`}>
        Scan a label below or pick a staged package from the queue.
      </div>
    </SidebarShell>
  );
}
