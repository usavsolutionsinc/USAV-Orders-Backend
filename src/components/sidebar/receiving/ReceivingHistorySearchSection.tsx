'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useIsFetching } from '@tanstack/react-query';
import {
  ClipboardList,
  Layout,
  Hash,
  Layers,
  FileText,
  Truck,
  Barcode,
  Cpu,
  AlertTriangle,
  Plus,
  Filter,
  ChevronDown,
} from '@/components/Icons';
import { SidebarSearchBar } from '@/components/ui/SidebarSearchBar';
import { useDebounce } from '@/hooks';
import {
  RECEIVING_HISTORY_SEARCH_FIELDS,
  RECEIVING_HISTORY_URL_PARAMS,
  setReceivingHistoryUrlParams,
  getReceivingHistoryHelperText,
  getReceivingHistoryPlaceholder,
  normalizeReceivingHistorySearchField,
  normalizeReceivingHistorySearchScope,
  type ReceivingHistorySearchField,
  type ReceivingHistorySearchScope,
} from '@/lib/receiving-history-search';
import { microBadge } from '@/design-system/tokens/typography/presets';

type ChipIcon = React.FC<{ className?: string }>;

const SCOPE_ITEMS: { id: ReceivingHistorySearchScope; label: string; icon: ChipIcon }[] = [
  { id: 'all', label: 'All', icon: Layout },
  { id: 'zoho_po', label: 'PO', icon: ClipboardList },
  { id: 'unmatched', label: 'Unmatched', icon: AlertTriangle },
];

const FIELD_ICONS: Record<ReceivingHistorySearchField, ChipIcon> = {
  all: Layers,
  po: Hash,
  tracking: Truck,
  sku: Barcode,
  product: FileText,
  serial: Cpu,
};

interface Props {
  /** Sidebar navigation to Receive tab (URL + state) */
  onSwitchToReceiving: () => void;
}

export function ReceivingHistorySearchSection({ onSwitchToReceiving }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQRaw = searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q) ?? '';
  const [draft, setDraft] = useState(urlQRaw);

  useEffect(() => {
    setDraft(urlQRaw);
  }, [urlQRaw]);

  const debouncedDraft = useDebounce(draft, 250);

  // Single-filter popover (mirrors IncomingSidebarPanel / ShippedCarrierFilters):
  // the carton-source scope and the search-field axis condense into one button
  // below the search bar instead of two horizontally-scrolling pill rows.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  const searchField = useMemo(
    () => normalizeReceivingHistorySearchField(searchParams.get(RECEIVING_HISTORY_URL_PARAMS.field)),
    [searchParams],
  );
  const searchScope = useMemo(
    () => normalizeReceivingHistorySearchScope(searchParams.get(RECEIVING_HISTORY_URL_PARAMS.scope)),
    [searchParams],
  );

  const replaceParams = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  // Debounced sync: draft → URL (`rh_q`)
  useEffect(() => {
    const trimmed = debouncedDraft.trim();
    const urlTrimmed = urlQRaw.trim();
    if (trimmed === urlTrimmed) return;

    replaceParams(setReceivingHistoryUrlParams(searchParams, { q: debouncedDraft }));
  }, [debouncedDraft, replaceParams, searchParams, urlQRaw]);

  const setScope = useCallback(
    (id: string) => {
      const scope = normalizeReceivingHistorySearchScope(id);
      replaceParams(setReceivingHistoryUrlParams(searchParams, { scope }));
    },
    [replaceParams, searchParams],
  );

  const setField = useCallback(
    (id: string) => {
      const field = normalizeReceivingHistorySearchField(id);
      replaceParams(setReceivingHistoryUrlParams(searchParams, { field }));
    },
    [replaceParams, searchParams],
  );

  const clearFilters = useCallback(() => {
    replaceParams(setReceivingHistoryUrlParams(searchParams, { scope: 'all', field: 'all' }));
  }, [replaceParams, searchParams]);

  // Scope + field each count as one active refinement (their `all` is the
  // unfiltered default, so it doesn't count).
  const activeFilterCount = (searchScope !== 'all' ? 1 : 0) + (searchField !== 'all' ? 1 : 0);

  const tableFetching =
    useIsFetching({
      predicate: (u) =>
        Array.isArray(u.queryKey) && u.queryKey[0] === 'receiving-lines-table',
    }) > 0;

  return (
    <div className="shrink-0 bg-white">
      {/* Search sits flush in its 40px band (matches Incoming + the
          pending/products reference); the filter control sits below it. */}
      <SidebarSearchBar
        value={draft}
        onChange={setDraft}
        placeholder={getReceivingHistoryPlaceholder(searchField)}
        isSearching={tableFetching}
        variant="blue"
        rightElement={
          <button
            type="button"
            onClick={() => {
              onSwitchToReceiving();
              queueMicrotask(() => {
                window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
              });
            }}
            className="rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-300"
            title="Receive — scan a new tracking number"
            aria-label="Switch to receiving tab and focus scan field"
          >
            <Plus className="h-5 w-5" />
          </button>
        }
      />
      <div className="space-y-2 pb-2">
        {/* Single filter entry point — the carton-source scope and the
            search-field axis condense into one popover below the search bar
            (mirrors IncomingSidebarPanel). */}
        <div className="relative px-1.5" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
              activeFilterCount > 0
                ? 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100'
                : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left">Filters</span>
            {activeFilterCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-mini font-black text-white">
                {activeFilterCount}
              </span>
            ) : null}
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>

          {filtersOpen ? (
            <div
              role="dialog"
              aria-label="Receiving history filters"
              className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-[70vh] space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5"
            >
              {/* Carton source — was the scope slider (All / PO / Unmatched). */}
              <div>
                <span className="mb-1.5 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                  Carton source
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {SCOPE_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const active = searchScope === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setScope(item.id)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                          active
                            ? 'bg-blue-600 text-white ring-blue-600'
                            : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Search field — was the field slider (All / PO # / … / Serial #). */}
              <div>
                <span className="mb-1.5 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                  Search field
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {RECEIVING_HISTORY_SEARCH_FIELDS.map((field) => {
                    const Icon = FIELD_ICONS[field.id];
                    const active = searchField === field.id;
                    return (
                      <button
                        key={field.id}
                        type="button"
                        onClick={() => setField(field.id)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                          active
                            ? 'bg-blue-600 text-white ring-blue-600'
                            : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {field.label}
                      </button>
                    );
                  })}
                </div>
                <p className={`${microBadge} mt-1.5 px-0.5 text-gray-500`}>
                  {getReceivingHistoryHelperText(searchField)}
                </p>
              </div>

              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="w-full text-center text-xs font-bold text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
