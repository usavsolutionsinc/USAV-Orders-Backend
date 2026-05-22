'use client';

import { useEffect, useState } from 'react';
import { Search, X, Loader2, AlertCircle } from '@/components/Icons';
import { platformStyle } from './platform-style';
import { usePairingQueue } from './usePairingQueue';
import type { PairingQueueItem } from './types';

interface PairingQueueListProps {
  selectedSku: string | null;
  onSelect: (item: PairingQueueItem) => void;
}

/**
 * Left rail: canonical SKUs that have at least one pairing suggestion.
 * Ordered by confidence × suggestion volume so the highest-leverage products
 * sit on top. Empty results = "everything's paired" success state.
 */
export function PairingQueueList({ selectedSku, onSelect }: PairingQueueListProps) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  // Debounce
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(draft.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [draft]);

  const { items, total, loading, error } = usePairingQueue(query);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      {/* Search */}
      <div className="shrink-0 border-b border-gray-200 px-3 py-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search products with pairing debt…"
            className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-8 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          {draft ? (
            <button
              type="button"
              onClick={() => setDraft('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>

      {/* Count bar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-500">
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
              {query ? 'No matches' : 'All caught up'}
            </p>
            <p className="mt-1 text-[10px] text-gray-400">
              {query
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
            <span className="text-[10px] font-bold text-gray-300">{item.sku.slice(0, 3)}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs font-bold text-gray-900">{item.sku}</span>
            <ConfidenceDot value={item.topConfidence} />
            <span className="text-[10px] font-semibold text-gray-400">
              {item.suggestionCount} suggested
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-gray-600">
            {item.productTitle || '—'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {item.platforms.map((p) => {
              const style = platformStyle(p);
              return (
                <span
                  key={p}
                  className={`inline-flex items-center rounded border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider ${style.chip}`}
                >
                  {style.label}
                </span>
              );
            })}
            {item.confirmedCount > 0 && (
              <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
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

const _useLoader = Loader2; // silence unused import; reserved for future spinners
void _useLoader;
