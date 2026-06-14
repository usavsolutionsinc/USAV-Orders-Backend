'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  PackageOpen,
  PackageCheck,
} from '@/components/Icons';
import { SidebarShell } from '@/components/layout/SidebarShell';
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
import {
  HISTORY_SORT_OPTIONS,
  HISTORY_DEFAULT_SORT,
  normalizeHistorySort,
} from '@/lib/receiving/receiving-modes';
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

// Sort axes come from the History mode descriptor (single source of truth);
// the sidebar only maps each id to an icon. Adding an axis there surfaces it
// here automatically.
const SORT_ICONS: Record<string, ChipIcon> = {
  scanned_newest: Barcode,
  unboxed_newest: PackageOpen,
  received_newest: PackageCheck,
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

  // The carton-source scope and the search-field axis condense into one
  // FilterRefinementBar (via SidebarShell's `filter` prop) below the search bar
  // — the same shared component the dashboard's Shipped sidebar uses.
  const searchField = useMemo(
    () => normalizeReceivingHistorySearchField(searchParams.get(RECEIVING_HISTORY_URL_PARAMS.field)),
    [searchParams],
  );
  const searchScope = useMemo(
    () => normalizeReceivingHistorySearchScope(searchParams.get(RECEIVING_HISTORY_URL_PARAMS.scope)),
    [searchParams],
  );
  // Shared `?sort=` param (modes are exclusive on /receiving). The descriptor
  // normalizes unknown values — incl. an Incoming sort left in the URL — to the
  // History default, so the control never shows a foreign axis.
  const sort = useMemo(
    () => normalizeHistorySort(searchParams.get('sort')),
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

  const setSort = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      const norm = normalizeHistorySort(id);
      // Keep the default axis out of the URL so a plain History link is clean.
      if (norm === HISTORY_DEFAULT_SORT) next.delete('sort');
      else next.set('sort', norm);
      replaceParams(next);
    },
    [replaceParams, searchParams],
  );

  const clearFilters = useCallback(() => {
    const next = setReceivingHistoryUrlParams(searchParams, { scope: 'all', field: 'all' });
    next.delete('sort');
    replaceParams(next);
  }, [replaceParams, searchParams]);

  // Scope + field each count as one active refinement (their `all` is the
  // unfiltered default, so it doesn't count) and surface as a removable chip.
  const refinements = useMemo(() => {
    const out: { id: string; label: string; onRemove: () => void }[] = [];
    // Non-default sort reads as a removable chip (default Scanned is implicit).
    if (sort !== HISTORY_DEFAULT_SORT) {
      const label = HISTORY_SORT_OPTIONS.find((o) => o.id === sort)?.label ?? sort;
      out.push({ id: 'sort', label: `Sort: ${label}`, onRemove: () => setSort(HISTORY_DEFAULT_SORT) });
    }
    if (searchScope !== 'all') {
      const label = SCOPE_ITEMS.find((s) => s.id === searchScope)?.label ?? searchScope;
      out.push({ id: 'scope', label, onRemove: () => setScope('all') });
    }
    if (searchField !== 'all') {
      const label =
        RECEIVING_HISTORY_SEARCH_FIELDS.find((f) => f.id === searchField)?.label ?? searchField;
      out.push({ id: 'field', label, onRemove: () => setField('all') });
    }
    return out;
  }, [sort, searchScope, searchField, setSort, setScope, setField]);
  const activeFilterCount = refinements.length;

  const tableFetching =
    useIsFetching({
      predicate: (u) =>
        Array.isArray(u.queryKey) && u.queryKey[0] === 'receiving-lines-table',
    }) > 0;

  return (
    // shrink-0 section (not a full panel) — override the shell's h-full +
    // overflow-hidden so it sizes to content and the filter popover isn't clipped.
    <SidebarShell
      className="h-auto shrink-0 overflow-visible bg-white"
      search={{
        value: draft,
        onChange: setDraft,
        placeholder: getReceivingHistoryPlaceholder(searchField),
        isSearching: tableFetching,
        variant: 'blue',
        rightElement: (
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
        ),
      }}
      filter={{
        label: 'Filters',
        refinements,
        onClearAll: activeFilterCount > 0 ? clearFilters : undefined,
        renderDropdown: () => (
          <div className="space-y-3">
            {/* Sort by — the History time axis (Scanned vs Unboxed). Drives both
                the day-band a row lands in and the order within it. Options come
                from the History mode descriptor (HISTORY_SORT_OPTIONS). */}
            <div>
              <span className="mb-1.5 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                Sort by
              </span>
              <div className="flex flex-wrap gap-1.5">
                {HISTORY_SORT_OPTIONS.map((option) => {
                  const Icon = SORT_ICONS[option.id] ?? Layers;
                  const active = sort === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSort(option.id)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                        active
                          ? 'bg-blue-600 text-white ring-blue-600'
                          : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

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
          </div>
        ),
      }}
    />
  );
}
