'use client';

/**
 * Ecwid product search popover.
 *
 * Used by UnfoundLineEditPanel when the operator clicks [+ Add item] on an
 * unmatched receiving. Searches /api/sku-catalog/search which already covers
 * both Ecwid product titles and platform SKUs via sku_platform_ids.
 *
 * The search endpoint returns `items[]` shaped like:
 *   {
 *     id: number,          // sku_platform_ids.id  (when searchField=title|ecwid_sku)
 *     sku: string | null,  // platform_sku
 *     zoho_sku: string,    // sku_catalog.sku (when joined)
 *     product_title: string,
 *     image_url: string | null,
 *     platform_ids: [{ platform, platform_sku, platform_item_id, account_name }]
 *   }
 *
 * On select, the popover fires onSelect with the catalog identifiers needed
 * to call POST /api/receiving/add-unmatched-line. We resolve sku_catalog_id
 * by re-querying the search endpoint with searchField=zoho_sku — the platform
 * search returns the joined catalog sku but not its primary key, so the parent
 * passes the receiving_id to a second endpoint call that joins it back.
 *
 * Alternative considered: have /api/sku-catalog/search return sc.id directly
 * for platform searches. That's a one-line server change but would touch a
 * shared endpoint — keep it scoped to this feature for now.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { microBadge } from '@/design-system/tokens/typography/presets';

export interface EcwidProductSelection {
  /** sku_platform_ids.id — the specific Ecwid listing row */
  sku_platform_id_row: number;
  /** sku_catalog.id — the canonical SKU (may be null if catalog row not paired yet) */
  sku_catalog_id: number | null;
  /** Display SKU shown to the operator (Ecwid platform SKU or Zoho catalog SKU) */
  sku: string;
  item_name: string;
  image_url: string | null;
  /** Set when the row came from /api/ecwid/recent-repair-orders (-RS SKU link). */
  is_repair_service?: boolean;
  ecwid_order_id?: string;
  ecwid_product_url?: string | null;
}

/** How the unmatched-items workspace opened this popover (parent supplies when visible). */
export type EcwidProductPopoverMode = 'search' | 'repair_service';

export interface EcwidProductSearchPopoverProps {
  /**
   * Receiving id is included in the selection callback so callers can wire
   * it into POST /api/receiving/add-unmatched-line without re-threading.
   */
  receivingId: number;
  /** Catalog search (`/api/sku-catalog/search`) vs recent repair-service Ecwid picks. */
  popoverMode: EcwidProductPopoverMode;
  /** Optional initial query (e.g. parsed product title from listing URL); catalog mode only */
  initialQuery?: string;
  onSelect: (selection: EcwidProductSelection) => void | Promise<void>;
  onClose: () => void;
}

interface PlatformIdRef {
  platform: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  account_name: string | null;
}

interface SearchItem {
  id: number;
  sku: string | null;
  zoho_sku: string | null;
  product_title: string;
  image_url: string | null;
  platform_ids: PlatformIdRef[];
  /** Present when the row was loaded from /api/ecwid/recent-repair-orders */
  order_id?: string;
  order_date?: string;
  product_url?: string | null;
}

interface SearchResponse {
  success: boolean;
  items?: SearchItem[];
  error?: string;
}

type CatalogSearchField = 'title' | 'ecwid_sku';

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 20;

export function EcwidProductSearchPopover({
  receivingId: _receivingId,
  popoverMode,
  initialQuery = '',
  onSelect,
  onClose,
}: EcwidProductSearchPopoverProps) {
  const [query, setQuery] = useState(initialQuery);
  const [searchField, setSearchField] = useState<CatalogSearchField>('title');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const listboxId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Recent repair-service orders (Ecwid `-RS` SKUs) ─────────────────────────
  useEffect(() => {
    if (popoverMode !== 'repair_service') return;
    let cancelled = false;
    setItems([]);
    setError(null);
    setIsLoading(true);
    abortRef.current?.abort();

    fetch('/api/ecwid/recent-repair-orders?limit=30')
      .then(async (res) => {
        const body = (await res.json()) as SearchResponse;
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `load failed (${res.status})`);
        }
        if (!cancelled) setItems(body.items ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to load repair orders');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [popoverMode]);

  // ─── Catalog search with debounce + abort ───────────────────────────────────
  useEffect(() => {
    if (popoverMode !== 'search') return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      abortRef.current?.abort();
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setError(null);

      const url = new URL('/api/sku-catalog/search', window.location.origin);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('searchField', searchField);
      url.searchParams.set('limit', String(MAX_RESULTS));

      fetch(url.toString(), { signal: controller.signal })
        .then(async (res) => {
          const body = (await res.json()) as SearchResponse;
          if (!res.ok || !body.success) {
            throw new Error(body.error ?? `search failed (${res.status})`);
          }
          setItems(body.items ?? []);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          setItems([]);
          setError(err instanceof Error ? err.message : 'search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [popoverMode, query, searchField]);

  // Cleanup on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  // ─── Escape closes ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ─── Select handler ────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    async (item: SearchItem) => {
      const displaySku = item.sku ?? item.zoho_sku ?? '';
      if (!displaySku && !item.product_title) return;
      setSubmittingId(item.id);
      try {
        await onSelect({
          sku_platform_id_row: item.id,
          // sku_catalog_id isn't returned by the platform-search branch; the
          // server-side add-unmatched-line endpoint accepts null here and can
          // resolve it from sku_platform_id_row at insert time.
          sku_catalog_id: null,
          sku: displaySku,
          item_name: item.product_title,
          image_url: item.image_url,
          ...(popoverMode === 'repair_service'
            ? {
                is_repair_service: true,
                ecwid_order_id: item.order_id ?? '',
                ecwid_product_url: item.product_url ?? null,
              }
            : {}),
        });
      } finally {
        setSubmittingId(null);
      }
    },
    [onSelect, popoverMode],
  );

  const placeholder = useMemo(
    () =>
      searchField === 'title'
        ? 'Search Ecwid product title…'
        : 'Search Ecwid SKU…',
    [searchField],
  );

  const dialogAria =
    popoverMode === 'repair_service'
      ? 'Recent Ecwid repair-service orders'
      : 'Search Ecwid products';

  if (typeof window === 'undefined') return null;

  // Portal-mounted centered modal so the workspace's overflow-y / stacking
  // contexts can't clip it. Backdrop covers the viewport; the dialog
  // wrapper pins to the top (items-start + top padding) and offsets right
  // by the desktop sidebar width so it visually centers on the workspace.
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="ecwid-search-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[118] bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="ecwid-search-dialog"
        role="dialog"
        aria-label={dialogAria}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[8vh] md:pl-[360px]"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl ring-1 ring-gray-200"
        >
      {/* Header: catalog toggle + close (repair mode is a fixed list) */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        {popoverMode === 'search' ? (
          <div className="flex gap-1">
            <ModeButton
              active={searchField === 'title'}
              onClick={() => setSearchField('title')}
              label="By title"
            />
            <ModeButton
              active={searchField === 'ecwid_sku'}
              onClick={() => setSearchField('ecwid_sku')}
              label="By SKU"
            />
          </div>
        ) : (
          <span className={`${microBadge} text-gray-700`}>
            Recent -RS Ecwid orders
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search input — catalog flow only */}
      {popoverMode === 'search' ? (
        <div className="px-2 pt-2">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder={placeholder}
            autoFocus
            isSearching={isLoading}
            variant="blue"
            size="compact"
            hideUnderline
          />
        </div>
      ) : (
        <p className="px-3 pt-2 text-micro text-gray-500">
          Pick an order containing a repair-service SKU to link this carton.
        </p>
      )}

      {/* Results — flex-1 lets the list grow to fill the dialog's max-h-[80vh]
          envelope instead of being artificially capped at 300px. */}
      <ul
        id={listboxId}
        role="listbox"
        aria-label={
          popoverMode === 'repair_service'
            ? 'Recent repair-service order lines'
            : 'Ecwid product results'
        }
        className="min-h-[120px] flex-1 overflow-y-auto"
      >
        {error && (
          <li className="px-3 py-3 text-label text-red-600">{error}</li>
        )}

        {!error &&
          !isLoading &&
          popoverMode === 'search' &&
          query.trim() &&
          items.length === 0 && (
          <li className="px-3 py-3 text-label text-gray-500">
            No matches. Try the other mode or refine the query.
          </li>
        )}

        {!error &&
          !isLoading &&
          popoverMode === 'repair_service' &&
          items.length === 0 && (
          <li className="px-3 py-3 text-label text-gray-500">
            No recent repair-service line items (-RS SKU) found in Ecwid orders.
          </li>
        )}

        {!error &&
          popoverMode === 'repair_service' &&
          isLoading &&
          items.length === 0 && (
            <li className="px-3 py-4 text-micro font-semibold text-gray-400">
              Loading recent Ecwid orders…
            </li>
          )}

        {items.map((item) => (
          <ResultRow
            key={item.id}
            item={item}
            showOrderMeta={popoverMode === 'repair_service'}
            isSubmitting={submittingId === item.id}
            disabled={submittingId != null && submittingId !== item.id}
            onSelect={handleSelect}
          />
        ))}
      </ul>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ─── Subcomponents (kept at module scope per `rerender-no-inline-components`) ──

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function ModeButton({ active, onClick, label }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${microBadge} rounded px-2 py-1 transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );
}

interface ResultRowProps {
  item: SearchItem;
  showOrderMeta?: boolean;
  isSubmitting: boolean;
  disabled: boolean;
  onSelect: (item: SearchItem) => void;
}

function ResultRow({ item, showOrderMeta, isSubmitting, disabled, onSelect }: ResultRowProps) {
  const platforms = item.platform_ids?.filter((p) => p?.platform) ?? [];
  const displaySku = item.sku ?? item.zoho_sku ?? '—';

  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        disabled={disabled || isSubmitting}
        onClick={() => onSelect(item)}
        className="flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2 text-left transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Thumbnail */}
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-gray-100 bg-gray-50">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-micro text-gray-300">
              —
            </div>
          )}
        </div>

        {/* Title + SKU + platform chips */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">
            {item.product_title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="font-mono text-micro tracking-wide text-gray-500">
              {displaySku}
            </span>
            {showOrderMeta && item.order_id ? (
              <span className="text-micro font-semibold normal-case text-sky-600">
                Order #{item.order_id}
              </span>
            ) : null}
            {platforms.slice(0, 4).map((p, i) => (
              <span
                key={`${p.platform}-${i}`}
                className={`${microBadge} rounded bg-gray-100 px-1.5 py-0.5 text-gray-600`}
              >
                {p.platform}
              </span>
            ))}
          </div>
        </div>

        {isSubmitting && (
          <span className="text-micro font-bold uppercase tracking-wider text-blue-600">
            Adding…
          </span>
        )}
      </button>
    </li>
  );
}
