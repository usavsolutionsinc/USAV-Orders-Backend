'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from '@/components/Icons';
import { platformStyle } from './platform-style';
import { usePairingQueue } from './usePairingQueue';
import type { PairingQueueItem, PairingSort } from './types';

interface PairingQueueListProps {
  /** Search fragment (sku/title). Comes from the shared sidebar SearchBar. */
  query: string;
  /** Sort key. Comes from the sidebar's sort pill row (URL-backed via ?sort=). */
  sort: PairingSort;
  selectedSku: string | null;
  onSelect: (item: PairingQueueItem) => void;
}

/**
 * Left rail: canonical SKUs that have at least one pairing suggestion.
 *
 * Search and sort are both owned by the parent sidebar — the SearchBar drives
 * `query` and the sort-pill row drives `sort`. This component is dumb: it just
 * fetches + renders. Default sort is `volume` (most-ordered first) so the
 * highest-leverage SKUs sit on top.
 *
 * Empty results = "everything's paired" success state.
 */
export function PairingQueueList({ query, sort, selectedSku, onSelect }: PairingQueueListProps) {
  // Debounce the search prop locally so a sidebar keystroke doesn't slam the
  // API on every character.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const { items, total, loading, error } = usePairingQueue(debouncedQuery, sort);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Count bar */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-gray-500">
        <span>
          {loading ? 'Loading…' : total === null ? '' : `${total} need review`}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && items.length === 0 ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-b border-gray-50 px-3 py-3">
                <div className="h-3 w-32 rounded bg-gray-100 animate-pulse" />
                <div className="mt-1.5 h-2.5 w-48 rounded bg-gray-50 animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-center text-xs text-red-600">
            <AlertCircle className="mx-auto mb-1 h-4 w-4" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-xs font-bold text-gray-500">
              {debouncedQuery ? 'No matches' : 'All caught up'}
            </p>
            <p className="mt-1 text-micro text-gray-400">
              {debouncedQuery
                ? 'Try a different search term.'
                : 'No pairing suggestions to review right now.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => (
              <PairingQueueRow
                key={item.skuCatalogId}
                item={item}
                selected={selectedSku != null && item.sku.toUpperCase() === selectedSku.toUpperCase()}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PairingQueueRow({
  item,
  selected,
  onSelect,
}: {
  item: PairingQueueItem;
  selected: boolean;
  onSelect: (item: PairingQueueItem) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
          selected ? 'bg-blue-50 border-l-2 border-l-blue-600' : 'hover:bg-gray-50'
        }`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-200">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-micro font-bold text-gray-300">{item.sku.slice(0, 3)}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs font-bold text-gray-900">{item.sku}</span>
            <ConfidenceDot value={item.topConfidence} />
            {item.orderCount > 0 && (
              <span
                className="inline-flex items-center rounded bg-amber-50 px-1 text-eyebrow font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200"
                title={`${item.orderCount} order line${item.orderCount === 1 ? '' : 's'} reference this SKU`}
              >
                {formatVolume(item.orderCount)} ord
              </span>
            )}
            <span className="text-micro font-semibold text-gray-400">
              {item.suggestionCount} suggested
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-caption leading-tight text-gray-600">
            {item.productTitle || '—'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {item.platforms.map((p) => {
              const style = platformStyle(p);
              return (
                <span
                  key={p}
                  className={`inline-flex items-center rounded border px-1.5 py-0 text-eyebrow font-semibold uppercase tracking-wider ${style.chip}`}
                >
                  {style.label}
                </span>
              );
            })}
            {item.confirmedCount > 0 && (
              <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-eyebrow font-semibold uppercase tracking-wider text-emerald-700">
                ✓ {item.confirmedCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function ConfidenceDot({ value }: { value: number }) {
  if (!value || value <= 0) return null;
  const color =
    value >= 80 ? 'bg-emerald-500'
    : value >= 60 ? 'bg-amber-500'
    : 'bg-slate-400';
  return (
    <span
      className={`inline-flex h-2 w-2 shrink-0 rounded-full ${color}`}
      title={`Top confidence: ${value}`}
      aria-label={`Top confidence ${value}`}
    />
  );
}

function formatVolume(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
