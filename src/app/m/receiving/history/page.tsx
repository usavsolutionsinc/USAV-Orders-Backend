'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  Menu,
  Barcode,
  Search,
  X,
  Box,
  PackageCheck,
  Clock,
  Calendar,
} from '@/components/Icons';
import { QuickAccessButton } from '@/components/layout/QuickAccessButton';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { MobileReceivingViewPills } from '@/components/mobile/receiving/MobileReceivingViewPills';
import { MobilePoQrScanSheet } from '@/components/mobile/receiving/MobilePoQrScanSheet';
import { MobileReceivingRow } from '@/components/mobile/receiving/MobileReceivingRow';
import { MobileCartonSheet } from '@/components/mobile/receiving/MobileCartonSheet';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

type FilterKey = 'all' | 'open' | 'received' | 'today';
type SortKey = 'scanned_newest' | 'scanned_oldest' | 'unboxed_newest';

const FILTERS: HorizontalSliderItem[] = [
  { id: 'all',      label: 'All',      icon: Box },
  { id: 'open',     label: 'Open',     icon: Clock },
  { id: 'received', label: 'Received', icon: PackageCheck },
  { id: 'today',    label: 'Today',    icon: Calendar },
];

const SORTS: HorizontalSliderItem[] = [
  { id: 'scanned_newest', label: 'Newest scan', icon: Clock },
  { id: 'scanned_oldest', label: 'Oldest scan', icon: Clock },
  { id: 'unboxed_newest', label: 'Unboxed',     icon: PackageCheck },
];

function openDrawer() {
  window.dispatchEvent(new CustomEvent('open-mobile-drawer'));
}

export default function MobileReceivingPipelinePage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('scanned_newest');
  const [search, setSearch] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [sheetRow, setSheetRow] = useState<ReceivingLineRow | null>(null);

  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  useRealtimeInvalidation({ receiving: true });

  const queryView = filter === 'received' ? 'received' : 'all';

  const { data, isLoading, error } = useQuery<ApiResponse>({
    queryKey: ['mobile-receiving-search', queryView, sort, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: '200',
        offset: '0',
        view: queryView,
        sort,
        include: 'serials',
      });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/receiving-lines?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  const rows = useMemo(() => {
    const all = data?.receiving_lines ?? [];
    if (filter === 'today') {
      const todayKey = getCurrentPSTDateKey();
      return all.filter((r) => toPSTDateKey(r.created_at) === todayKey);
    }
    if (filter === 'open') {
      return all.filter((r) => {
        const wf = String(r.workflow_status || 'EXPECTED').toUpperCase();
        return wf !== 'DONE' && wf !== 'PASSED' && wf !== 'RECEIVED' && wf !== 'SCRAP' && wf !== 'RTV';
      });
    }
    return all;
  }, [data, filter]);

  const handleDecode = useCallback((value: string) => {
    setSearch(value.trim());
  }, []);

  const buildPhotosHref = useCallback(
    (row: ReceivingLineRow) =>
      row.receiving_id ? `/m/r/${row.receiving_id}/photos` : '#',
    [],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <header className="sticky top-0 z-header flex min-h-14 items-center gap-3 border-b border-gray-100 bg-white px-3 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Open navigation"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 active:bg-gray-100 transition-colors outline-none"
        >
          <Menu className="h-6 w-6" />
        </button>

        <h1 className="flex-1 text-lg font-black tracking-tight text-gray-900">
          Receiving
        </h1>

        <QuickAccessButton className="h-10 w-10" />
      </header>

      <main className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Floating overlay — sticky, transparent, list scrolls behind. */}
        <div className="sticky top-0 z-sticky flex flex-col gap-2 px-3 pt-2 pb-3 pointer-events-none">
          <div className="pointer-events-auto">
            <MobileReceivingViewPills active="pos" />
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                inputMode="search"
                placeholder="Search PO #, SKU, or item"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-full border border-gray-200 bg-white pl-9 pr-9 text-sm font-semibold text-gray-900 placeholder:text-gray-400 shadow-md shadow-black/10 focus:border-blue-500 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              aria-label="Scan PO barcode"
              className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 active:bg-blue-700 transition-colors"
            >
              <Barcode className="h-5 w-5" />
            </button>
          </div>

          <div className="pointer-events-auto">
            <HorizontalButtonSlider
              items={FILTERS}
              value={filter}
              onChange={(id) => setFilter(id as FilterKey)}
              variant="floating"
              size="lg"
              aria-label="Receiving status filter"
            />
          </div>

          <div className="pointer-events-auto">
            <HorizontalButtonSlider
              items={SORTS}
              value={sort}
              onChange={(id) => setSort(id as SortKey)}
              variant="floating"
              size="md"
              aria-label="Receiving sort order"
            />
          </div>
        </div>

        {/* List body — pads top so first rows clear the overlay before scrolling under it. */}
        {isLoading && rows.length === 0 ? (
          <div className="space-y-2 px-3 pt-3 pb-12">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[72px] animate-pulse rounded-2xl bg-gray-100"
                aria-hidden
              />
            ))}
          </div>
        ) : error ? (
          <p className="px-6 py-12 text-center text-label font-bold text-rose-600">
            Couldn't load receiving lines. Pull to refresh.
          </p>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-700">
              No matches
            </p>
            <p className="mt-1 text-caption font-semibold text-gray-500">
              Try switching the filter, clearing the search, or scanning a PO label.
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col pb-12">
            {rows.map((row) => (
              <MobileReceivingRow
                key={row.id}
                row={row}
                variant="collapsed"
                onTap={() => setSheetRow(row)}
                photosHref={buildPhotosHref(row)}
              />
            ))}
          </div>
        )}
      </main>

      <MobileCartonSheet
        row={sheetRow}
        staffId={staffId}
        open={sheetRow != null}
        onClose={() => setSheetRow(null)}
      />

      <MobilePoQrScanSheet
        isOpen={scanOpen}
        onClose={() => setScanOpen(false)}
        onDecode={handleDecode}
      />
    </div>
  );
}
