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
import { motion } from 'framer-motion';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  framerPresence,
  framerTransition,
} from '@/design-system/foundations/motion-framer';
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
}

export interface EcwidProductSearchPopoverProps {
  /**
   * Receiving id is included in the selection callback so callers can wire
   * it into POST /api/receiving/add-unmatched-line without re-threading.
   */
  receivingId: number;
  /** Optional initial query (e.g. parsed product title from listing URL) */
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
}

interface SearchResponse {
  success: boolean;
  items?: SearchItem[];
  error?: string;
}

type SearchMode = 'title' | 'ecwid_sku';

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 20;

export function EcwidProductSearchPopover({
  receivingId: _receivingId,
  initialQuery = '',
  onSelect,
  onClose,
}: EcwidProductSearchPopoverProps) {
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>('title');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const listboxId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Search with debounce + abort ──────────────────────────────────────────
  useEffect(() => {
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
      url.searchParams.set('searchField', mode);
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
  }, [query, mode]);

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
        });
      } finally {
        setSubmittingId(null);
      }
    },
    [onSelect],
  );

  const placeholder = useMemo(
    () =>
      mode === 'title'
        ? 'Search Ecwid product title…'
        : 'Search Ecwid SKU…',
    [mode],
  );

  return (
    <motion.div
      role="dialog"
      aria-label="Search Ecwid products"
      initial={framerPresence.dropdownPanel.initial}
      animate={framerPresence.dropdownPanel.animate}
      exit={framerPresence.dropdownPanel.exit}
      transition={framerTransition.dropdownOpen}
      className="absolute inset-x-0 top-0 z-40 mx-2 max-h-[420px] overflow-hidden rounded-lg border border-blue-200 bg-white shadow-xl"
    >
      {/* Header: mode toggle + close */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div className="flex gap-1">
          <ModeButton
            active={mode === 'title'}
            onClick={() => setMode('title')}
            label="By title"
          />
          <ModeButton
            active={mode === 'ecwid_sku'}
            onClick={() => setMode('ecwid_sku')}
            label="By SKU"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${microBadge} rounded px-2 py-1 text-gray-500 hover:bg-gray-100`}
        >
          Esc
        </button>
      </div>

      {/* Search input */}
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

      {/* Results */}
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Ecwid product results"
        className="mt-1 max-h-[300px] overflow-y-auto"
      >
        {error && (
          <li className="px-3 py-3 text-[12px] text-red-600">{error}</li>
        )}

        {!error && !isLoading && query.trim() && items.length === 0 && (
          <li className="px-3 py-3 text-[12px] text-gray-500">
            No matches. Try the other mode or refine the query.
          </li>
        )}

        {items.map((item) => (
          <ResultRow
            key={item.id}
            item={item}
            isSubmitting={submittingId === item.id}
            disabled={submittingId != null && submittingId !== item.id}
            onSelect={handleSelect}
          />
        ))}
      </ul>
    </motion.div>
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
  isSubmitting: boolean;
  disabled: boolean;
  onSelect: (item: SearchItem) => void;
}

function ResultRow({ item, isSubmitting, disabled, onSelect }: ResultRowProps) {
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
            <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-300">
              —
            </div>
          )}
        </div>

        {/* Title + SKU + platform chips */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-gray-900">
            {item.product_title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="font-mono text-[10px] tracking-wide text-gray-500">
              {displaySku}
            </span>
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
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
            Adding…
          </span>
        )}
      </button>
    </li>
  );
}
