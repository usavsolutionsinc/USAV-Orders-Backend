'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { unshippedOrdersQuery } from '@/lib/queries/dashboard-queries';
import { ShippedFormData } from '@/components/shipped';
import { ShippedIntakeForm } from '@/components/shipped/ShippedIntakeForm';
import { Plus, Check } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { ShippedScanOutSidebar } from '@/components/shipped/ShippedScanOutSidebar';
import { DashboardShippedSearchHandoffCard } from '@/components/dashboard/DashboardShippedSearchHandoffCard';
import { OrdersSyncPopover } from '@/components/unshipped/OrdersSyncPopover';
import { motion } from 'framer-motion';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SidebarShell } from '@/components/layout/SidebarShell';
import type { FilterRefinement } from '@/design-system/components/FilterRefinementBar';
import { StatusLegend, type StatusLegendItem } from '@/components/ui/StatusLegend';
import { SavedViewsControl } from '@/components/sidebar/SavedViewsControl';
import { UNSHIPPED_STATE_META, countUnshippedStates, type UnshippedState } from '@/lib/unshipped-state';

/** Params that define an Unshipped saved view (filters only — not search text). */
const UNSHIPPED_VIEW_PARAMS = ['stage', 'sort', 'ustatus'] as const;

/** Pre-dock status legend subset — distinct hues, ordered along the pipeline. */
const UNSHIPPED_LEGEND_ITEMS: StatusLegendItem<UnshippedState>[] = [
  { state: 'AWAITING_LABEL', short: 'Awaiting' },
  { state: 'PENDING', short: 'Pending' },
  { state: 'TESTED', short: 'Tested' },
  { state: 'PACKED_STAGED', short: 'Packed' },
  { state: 'BLOCKED', short: 'Blocked' },
];

/** The stages folded into the merged Unshipped mode. `tested` is the pending
 *  subset that's already tech-tested and currently being packed. */
type UnshippedStage = 'all' | 'awaiting' | 'pending' | 'tested';
const STAGE_OPTIONS: { id: UnshippedStage; label: string; hint: string }[] = [
  { id: 'awaiting', label: 'Awaiting tracking', hint: 'No carrier label yet' },
  { id: 'all', label: 'All unshipped', hint: 'Awaiting + Pending' },
  { id: 'pending', label: 'Pending packing', hint: 'Labeled, not packed' },
  { id: 'tested', label: 'Tested, packing', hint: 'Tech-tested, packing now' },
];

/** Sort order for the queue — written to `?sort`, read by UnshippedTable. */
type UnshippedSort = 'priority' | 'newest';
const SORT_OPTIONS: { id: UnshippedSort; label: string }[] = [
  { id: 'priority', label: 'Priority (due soon)' },
  { id: 'newest', label: 'Newest first' },
];

interface UnshippedSidebarProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  embedded?: boolean;
  hideSectionHeader?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onOpenShippedMatches?: (searchQuery: string) => void;
}

interface SearchHistory {
  query: string;
  timestamp: Date;
  resultCount?: number;
}

export default function UnshippedSidebar(props: UnshippedSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    showIntakeForm = false,
    onCloseForm,
    onFormSubmit,
    filterControl,
    embedded = false,
    hideSectionHeader = false,
    searchValue = '',
    onSearchChange,
    onOpenShippedMatches,
  } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchQuery(searchValue);
  }, [searchValue]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dashboard_search_history');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setSearchHistory(
        parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }))
      );
    } catch (_error) {
      setSearchHistory([]);
    }
  }, []);

  const saveSearchHistory = (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const newHistory = [
      { query: trimmedQuery, timestamp: new Date() },
      ...searchHistory.filter((item) => item.query !== trimmedQuery).slice(0, 4),
    ];
    setSearchHistory(newHistory);
    localStorage.setItem('dashboard_search_history', JSON.stringify(newHistory));
  };

  const handleSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      saveSearchHistory(trimmedQuery);
    }
    await onSearchChange?.(trimmedQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSearchChange]);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleSearch(value);
    }, 400);
  }, [handleSearch]);

  const clearSearchHistory = () => {
    setSearchHistory([]);
    setShowAllSearchHistory(false);
    localStorage.removeItem('dashboard_search_history');
  };

  const handleOpenIntakeForm = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('new', 'true');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname || '/dashboard'}?${nextSearch}` : pathname || '/dashboard');
  };

  // ── Stage filter (the merged Awaiting/Pending split) ──────────────────────
  // Reuses the shared FilterRefinementBar via SidebarShell's `filter` prop, same
  // as receiving's Incoming facet filter. Writes `?stage`; UnshippedTable reads
  // it back. `all` clears the param.
  const stageParam = String(searchParams.get('stage') || 'all').toLowerCase();
  const stage: UnshippedStage =
    stageParam === 'awaiting' ? 'awaiting'
      : stageParam === 'pending' ? 'pending'
        : stageParam === 'tested' ? 'tested'
          : 'all';

  const setStage = useCallback(
    (next: UnshippedStage) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'all') params.delete('stage');
      else params.set('stage', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard');
    },
    [router, pathname, searchParams],
  );

  // Status legend click-to-filter (`?ustatus`). Clicking the lit chip clears it.
  const activeStatus = (searchParams.get('ustatus') || '') as UnshippedState | '';
  const toggleStatus = useCallback(
    (state: UnshippedState) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get('ustatus') === state) params.delete('ustatus');
      else params.set('ustatus', state);
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard', { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const sortParam = String(searchParams.get('sort') || 'priority').toLowerCase();
  const sort: UnshippedSort = sortParam === 'newest' ? 'newest' : 'priority';

  const setSort = useCallback(
    (next: UnshippedSort) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'priority') params.delete('sort');
      else params.set('sort', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard');
    },
    [router, pathname, searchParams],
  );

  // Single-pass clear (both params at once) — chaining setStage + setSort would
  // each rebuild from the same stale searchParams and clobber the other.
  const clearAllFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('stage');
    params.delete('sort');
    const qs = params.toString();
    router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard');
  }, [router, pathname, searchParams]);

  // Per-stage counts for the filter dropdown. Reuses the SAME query key the
  // table mounts (React Query dedupes → one fetch, no extra request).
  const { data: stageData, isFetching: stageFetching } = useQuery({
    ...unshippedOrdersQuery({ searchQuery: searchValue, strictSearchScope: true }),
    placeholderData: (previous) => previous,
  });
  // Pre-dock status-dot counts for the legend, derived from the SAME query rows
  // the table mounts (no extra fetch). Distinct from `stageCounts`, which buckets
  // by the coarser Awaiting/Pending/Tested filter facet.
  const statusCounts = useMemo(() => countUnshippedStates(stageData ?? []), [stageData]);
  const stageCounts = useMemo(() => {
    const rows = stageData ?? [];
    const pending = rows.filter((r) => r.shipment_id != null);
    return {
      all: rows.length,
      awaiting: rows.filter((r) => r.shipment_id == null).length,
      pending: pending.length,
      tested: pending.filter((r) => Boolean((r as { has_tech_scan?: boolean }).has_tech_scan)).length,
    } as Record<UnshippedStage, number>;
  }, [stageData]);

  const filterRefinements = useMemo((): FilterRefinement[] => {
    const out: FilterRefinement[] = [];
    if (stage !== 'all') {
      const label = stage === 'awaiting' ? 'Awaiting' : stage === 'tested' ? 'Tested' : 'Pending';
      const pillClassName =
        stage === 'awaiting'
          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
          : stage === 'tested'
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
            : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
      out.push({ id: 'stage', label, onRemove: () => setStage('all'), pillClassName });
    }
    if (sort !== 'priority') {
      out.push({
        id: 'sort',
        label: 'Newest',
        onRemove: () => setSort('priority'),
        pillClassName: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200',
      });
    }
    return out;
  }, [stage, sort, setStage, setSort]);

  if (showIntakeForm) {
    return (
      <ShippedIntakeForm
        onClose={onCloseForm || (() => {})}
        onSubmit={onFormSubmit || (() => {})}
      />
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
    },
  };

  const visibleSearchHistory = showAllSearchHistory ? searchHistory : searchHistory.slice(0, 3);

  const content = (
    <SidebarShell
      as={motion.div}
      containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
      headerAbove={
        <>
          {filterControl ? (
            <motion.div variants={itemVariants} className="relative z-20">
              {filterControl}
            </motion.div>
          ) : null}
          {!hideSectionHeader ? (
            <motion.header variants={itemVariants} className={`${SIDEBAR_GUTTER} ${filterControl ? 'pt-2' : 'pt-6'}`}>
              <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                Unshipped
              </h2>
              <p className="text-eyebrow font-bold text-blue-600 uppercase tracking-widest mt-1">
                Shipping Queue
              </p>
            </motion.header>
          ) : null}
        </>
      }
      filter={{
        label: 'Filters',
        refinements: filterRefinements,
        activeCount: filterRefinements.length,
        onClearAll: filterRefinements.length > 0 ? clearAllFilters : undefined,
        renderDropdown: (onClose: () => void) => (
          <div className="space-y-3">
            <div>
              <span className="mb-1.5 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                Stage
              </span>
              <div className="space-y-1.5">
                {STAGE_OPTIONS.map((opt) => {
                  const active = stage === opt.id;
                  const count = stageCounts[opt.id];
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { setStage(opt.id); onClose(); }}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      {/* Count first, fixed width → every row's number lines up in one column. */}
                      <span className="shrink-0 w-9 rounded-full bg-gray-100 px-1.5 py-0.5 text-center text-eyebrow font-bold tabular-nums text-gray-600">
                        {count}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900">{opt.label}</span>
                      <span className="shrink-0 text-eyebrow font-medium text-gray-400">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                Sort
              </span>
              <div className="space-y-1.5">
                {SORT_OPTIONS.map((opt) => {
                  const active = sort === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { setSort(opt.id); onClose(); }}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                        active ? 'border-blue-300 bg-blue-50 text-gray-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                      {active ? <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ),
      }}
      search={{
        value: searchQuery,
        onChange: handleInputChange,
        onSearch: handleSearch,
        onClear: () => { setSearchQuery(''); handleSearch(''); },
        inputRef: searchInputRef,
        placeholder: 'Search orders, serials...',
        variant: 'blue',
        rightElement: (
          <button
            type="button"
            onClick={handleOpenIntakeForm}
            className="rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-300"
            title="New Order Entry"
            aria-label="Open new order entry form"
          >
            <Plus className="h-5 w-5" />
          </button>
        ),
      }}
      // Status-dot color key + live counts — pinned so it explains the table's
      // pre-dock dots (mirrors the Shipped mode's OutboundStatusLegend).
      headerBelow={
        <div className={`${SIDEBAR_GUTTER} space-y-1.5 pb-1`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Click a dot to filter</span>
            <SavedViewsControl storageKey="unshipped_saved_views" paramKeys={UNSHIPPED_VIEW_PARAMS} />
          </div>
          <StatusLegend
            items={UNSHIPPED_LEGEND_ITEMS}
            meta={UNSHIPPED_STATE_META}
            counts={statusCounts}
            isFetching={stageFetching}
            activeState={activeStatus || null}
            onSelectState={toggleStatus}
          />
        </div>
      }
      bodyClassName="flex flex-col no-scrollbar pb-6"
      // Dock scan-out pinned at the very bottom — always available (no mode
      // toggle). The list above is unchanged; scanning a staged label hands the
      // order off to the carrier (PACKED_STAGED → SCANNED_OUT) and drops it from
      // this board into Shipped. autoFocus off so it never steals the search box.
      footer={
        <div className={`${SIDEBAR_GUTTER} border-t border-gray-100 bg-white pb-4 pt-3`}>
          <ShippedScanOutSidebar autoFocus={false} />
        </div>
      }
    >
      <motion.div variants={itemVariants} initial="hidden" animate="visible" className="space-y-4">
        <RecentSearchesList
          items={visibleSearchHistory}
          totalCount={searchHistory.length}
          expanded={showAllSearchHistory}
          onToggleExpanded={() => setShowAllSearchHistory((current) => !current)}
          onClear={clearSearchHistory}
          onSelect={(query) => {
            setSearchQuery(query);
            handleSearch(query);
          }}
        />
        <DashboardShippedSearchHandoffCard
          searchQuery={searchQuery}
          onOpenShippedMatches={onOpenShippedMatches}
        />
      </motion.div>

      <OrdersSyncPopover
        onRefresh={() => {
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }}
      />
    </SidebarShell>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-white">{content}</div>;
  }

  return (
    <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative w-[300px]">
      {content}
    </aside>
  );
}
