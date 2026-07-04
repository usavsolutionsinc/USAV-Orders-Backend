'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { Check } from '@/components/Icons';
import { StatusLegend, type StatusLegendItem } from '@/components/ui/StatusLegend';
import { UNSHIPPED_STATE_META, countUnshippedStates } from '@/lib/unshipped-state';
import { awaitingLabelsQuery } from '@/lib/queries/outbound-queries';
import { OUTBOUND_SORT_OPTIONS } from '@/components/outbound/outbound-sidebar-shared';
import { useOutboundUrlState } from '@/hooks/useOutboundUrlState';

const AWAITING_LEGEND: StatusLegendItem<'AWAITING_LABEL'>[] = [
  { state: 'AWAITING_LABEL', short: 'Awaiting' },
];

/** Labels mode sidebar — search, sort, and queue stats only (list lives in the right pane). */
export function LabelsModeBody() {
  const { q, sort, setQ, setSort } = useOutboundUrlState();
  const [searchInput, setSearchInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const labelsQuery = useQuery(awaitingLabelsQuery({ searchQuery: q, sort }));
  const statusCounts = countUnshippedStates(labelsQuery.data ?? []);
  const queueCount = labelsQuery.data?.length ?? 0;

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
        placeholder: 'Search order #, SKU, title…',
        variant: 'blue',
      }}
      filter={{
        label: 'Sort',
        refinements: sort !== 'priority'
          ? [{ id: 'sort', label: 'Newest first', onRemove: () => setSort('priority') }]
          : [],
        activeCount: sort !== 'priority' ? 1 : 0,
        onClearAll: sort !== 'priority' ? () => setSort('priority') : undefined,
        renderDropdown: (onClose) => (
          <div className="space-y-1.5">
            {OUTBOUND_SORT_OPTIONS.map((opt) => {
              const active = sort === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => { setSort(opt.id); onClose(); }}
                  className={`ds-raw-button flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                    active ? 'border-violet-300 bg-violet-50 text-text-default' : 'border-border-soft bg-surface-card text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {opt.label}
                  {active ? <Check className="h-3.5 w-3.5 shrink-0 text-violet-600" /> : null}
                </button>
              );
            })}
          </div>
        ),
      }}
      headerBelow={
        <div className={`${SIDEBAR_GUTTER} space-y-2 pb-1`}>
          <StatusLegend
            items={AWAITING_LEGEND}
            meta={UNSHIPPED_STATE_META}
            counts={statusCounts}
            isFetching={labelsQuery.isFetching}
            activeState={null}
            onSelectState={() => undefined}
          />
          <p className="text-eyebrow font-bold uppercase tracking-widest text-violet-600">
            {queueCount} order{queueCount === 1 ? '' : 's'} awaiting label
          </p>
        </div>
      }
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className={`${SIDEBAR_GUTTER} text-sm text-text-soft`}>
        Select a row in the queue to attach a carrier label.
      </div>
    </SidebarShell>
  );
}
