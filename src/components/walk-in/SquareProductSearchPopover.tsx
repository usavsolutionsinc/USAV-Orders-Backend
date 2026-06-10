'use client';

/**
 * Square product search popover (walk-in sales).
 *
 * The sales counterpart to {@link ../receiving/unfound/EcwidProductSearchPopover}:
 * same portal-mounted modal, debounced search + abort, results list, and
 * "Product not added yet?" manual-title path. The only difference is the
 * source — this searches the Square catalog (`/api/walk-in/catalog`) so the
 * selection carries a `catalog_object_id` the terminal can charge. The manual
 * path stages an ad-hoc line (title + price, no Square id).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { formatCentsToDollars, parsePriceToMinorUnits } from '@/lib/square/client';
import type { SquareCatalogItem } from '@/hooks/useSquareCatalog';
import type { SalesProductInput } from './salesCartStore';

export interface SquareProductSearchPopoverProps {
  onSelect: (selection: SalesProductInput) => void | Promise<void>;
  onClose: () => void;
}

const DEBOUNCE_MS = 200;

export function SquareProductSearchPopover({ onSelect, onClose }: SquareProductSearchPopoverProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SquareCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  /** Operator-entered title when the product is not in the Square catalog. */
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const manualLockRef = useRef(false);

  const listboxId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Catalog search with debounce + abort ───────────────────────────────────
  useEffect(() => {
    if (manualMode) return;

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

      const url = new URL('/api/walk-in/catalog', window.location.origin);
      url.searchParams.set('q', trimmed);

      fetch(url.toString(), { signal: controller.signal })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error ?? `search failed (${res.status})`);
          setItems(Array.isArray(body?.items) ? (body.items as SquareCatalogItem[]) : []);
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
  }, [query, manualMode]);

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

  const handleSelect = useCallback(
    async (item: SquareCatalogItem) => {
      const v = item.item_data?.variations?.[0];
      if (!v) return;
      const vd = v.item_variation_data;
      setSubmittingId(v.id);
      try {
        await onSelect({
          variationId: v.id,
          sku: vd?.sku ?? '',
          product_title: item.item_data?.name ?? 'Item',
          image_url: null,
          unitAmount: vd?.price_money?.amount ?? 0,
          isManual: false,
        });
      } finally {
        setSubmittingId(null);
      }
    },
    [onSelect],
  );

  const handleManualSubmit = useCallback(async () => {
    const title = manualTitle.trim();
    if (!title) return;
    if (manualLockRef.current) return;
    manualLockRef.current = true;
    setManualSubmitting(true);
    try {
      await onSelect({
        variationId: null,
        sku: '',
        product_title: title,
        image_url: null,
        unitAmount: parsePriceToMinorUnits(manualPrice) ?? 0,
        isManual: true,
      });
    } finally {
      manualLockRef.current = false;
      setManualSubmitting(false);
    }
  }, [manualTitle, manualPrice, onSelect]);

  if (typeof window === 'undefined') return null;

  // Portal-mounted centered modal mirroring EcwidProductSearchPopover so the
  // workspace's overflow/stacking contexts can't clip it.
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="sales-search-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-panelPopover bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="sales-search-dialog"
        role="dialog"
        aria-label={manualMode ? 'Enter product title manually' : 'Search Square products'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none fixed inset-0 z-panelPopover flex items-start justify-center p-4 pt-[8vh] md:pl-[360px]"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl ring-1 ring-gray-200"
        >
          {/* Header: manual toggle + close */}
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            {manualMode ? (
              <button
                type="button"
                onClick={() => {
                  setManualMode(false);
                  setManualTitle('');
                  setManualPrice('');
                }}
                className={`${microBadge} rounded px-2 py-1 text-emerald-700 transition-colors hover:bg-emerald-50`}
              >
                ← Back to catalog search
              </button>
            ) : (
              <span className={`${microBadge} text-gray-700`}>Search Square catalog</span>
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

          {/* Search input — catalog flow */}
          {!manualMode ? (
            <div className="px-2 pt-2">
              <SearchBar
                value={query}
                onChange={setQuery}
                placeholder="Search product name or SKU…"
                autoFocus
                isSearching={isLoading}
                variant="emerald"
                size="compact"
                hideUnderline
                trailingPrefix={
                  <button
                    type="button"
                    onClick={() => {
                      setManualMode(true);
                      setManualTitle('');
                      setManualPrice('');
                      setQuery('');
                      setItems([]);
                      setError(null);
                      abortRef.current?.abort();
                      setIsLoading(false);
                    }}
                    className="max-w-[min(11rem,calc(100vw-200px))] shrink-0 truncate rounded-md border border-emerald-200 bg-emerald-50/80 px-1.5 py-0.5 text-left text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100 sm:max-w-[14rem] sm:text-caption sm:leading-tight"
                    title="Product not added yet?"
                  >
                    Product not added yet?
                  </button>
                }
              />
            </div>
          ) : (
            <div className="space-y-2 px-2 pt-2">
              <SearchBar
                value={manualTitle}
                onChange={setManualTitle}
                placeholder="Enter product title to add"
                autoFocus
                variant="emerald"
                size="compact"
                hideUnderline
              />
              <div className="px-1">
                <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
                  Price
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-caption font-bold text-emerald-700">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    placeholder="0.00"
                    className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-6 pr-3 text-caption font-bold text-emerald-700 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={manualSubmitting || submittingId != null || !manualTitle.trim()}
                onClick={() => void handleManualSubmit()}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-caption font-bold uppercase tracking-wider text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {manualSubmitting ? 'Adding…' : 'Add to sale'}
              </button>
            </div>
          )}

          {/* Results */}
          {!manualMode ? (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Square product results"
              className="min-h-[120px] flex-1 overflow-y-auto"
            >
              {error && <li className="px-3 py-3 text-label text-red-600">{error}</li>}

              {!error && !isLoading && query.trim() && items.length === 0 && (
                <li className="px-3 py-3 text-label text-gray-500">
                  No matches. Refine the query, or use &ldquo;Product not added yet?&rdquo; for a manual line.
                </li>
              )}

              {items.map((item) => {
                const v = item.item_data?.variations?.[0];
                if (!v) return null;
                const vd = v.item_variation_data;
                return (
                  <SalesResultRow
                    key={item.id}
                    name={item.item_data?.name ?? 'Item'}
                    sku={vd?.sku ?? ''}
                    price={vd?.price_money?.amount ?? 0}
                    isSubmitting={submittingId === v.id}
                    disabled={submittingId != null && submittingId !== v.id}
                    onSelect={() => void handleSelect(item)}
                  />
                );
              })}
            </ul>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ─── Subcomponent (module scope per `rerender-no-inline-components`) ───────────

interface SalesResultRowProps {
  name: string;
  sku: string;
  price: number;
  isSubmitting: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function SalesResultRow({ name, sku, price, isSubmitting, disabled, onSelect }: SalesResultRowProps) {
  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        disabled={disabled || isSubmitting}
        onClick={onSelect}
        className="flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2 text-left transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Thumbnail — Square catalog search carries no image, so placeholder. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-100 bg-gray-50">
          <Package className="h-5 w-5 text-gray-300" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">{name}</div>
          {sku ? (
            <div className="mt-0.5 font-mono text-micro tracking-wide text-gray-500">{sku}</div>
          ) : null}
        </div>

        <span className="shrink-0 text-caption font-black text-emerald-600">
          {formatCentsToDollars(price)}
        </span>

        {isSubmitting && (
          <span className="text-micro font-bold uppercase tracking-wider text-emerald-600">
            Adding…
          </span>
        )}
      </button>
    </li>
  );
}
