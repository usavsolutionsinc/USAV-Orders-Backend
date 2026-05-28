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
} from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
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

const SCOPE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', icon: Layout },
  { id: 'zoho_po', label: 'PO', icon: ClipboardList },
  { id: 'unmatched', label: 'Unmatched', icon: AlertTriangle },
];

const FIELD_ICONS: Record<ReceivingHistorySearchField, NonNullable<HorizontalSliderItem['icon']>> = {
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

  const tableFetching =
    useIsFetching({
      predicate: (u) =>
        Array.isArray(u.queryKey) && u.queryKey[0] === 'receiving-lines-table',
    }) > 0;

  return (
    <div className={`${sidebarHeaderBandClass} border-gray-100`}>
      <div className="space-y-3 px-3 py-3">
        <SearchBar
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

        <HorizontalButtonSlider
          items={SCOPE_ITEMS}
          value={searchScope}
          onChange={setScope}
          variant="nav"
          aria-label="Receiving carton source"
        />

        <HorizontalButtonSlider
          items={RECEIVING_HISTORY_SEARCH_FIELDS.map((field) => ({
            id: field.id,
            label: field.label,
            icon: FIELD_ICONS[field.id],
          }))}
          value={searchField}
          onChange={setField}
          variant="nav"
          size="md"
          aria-label="Receiving history search field"
          // Left inset so the first pill isn't flush to the edge at min scroll.
          className="pl-3"
        />

        <p className={`${microBadge} text-gray-500 px-0.5`}>
          {getReceivingHistoryHelperText(searchField)}
        </p>
      </div>
    </div>
  );
}
