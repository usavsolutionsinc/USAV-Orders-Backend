'use client';

import { useEffect, useState } from 'react';
import { Plus, Link2, Loader2 } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { platformStyle } from './platform-style';
import type { SearchUnmatchedResponse, UnmappedPlatformId } from './types';

interface Props {
  /** Debounced sidebar search term. */
  query: string;
  /** Open the add/pair modal for a specific unmapped identifier. */
  onPairIdentifier: (id: UnmappedPlatformId) => void;
  /** Open the add modal to create a brand-new Zoho SKU from the query. */
  onAddSku: () => void;
}

/**
 * Sits beneath the canonical pairing queue. When a search yields no canonical
 * row to land on, this surfaces the two recoverable gaps:
 *   • unmapped account-source identifiers (ASIN/eBay/Walmart/Ecwid) → pair them
 *   • the searched Zoho SKU isn't in the catalog → add it
 * Renders nothing when the query is empty or there's nothing actionable.
 */
export function PairingUnmatchedSection({ query, onPairIdentifier, onAddSku }: Props) {
  const [data, setData] = useState<SearchUnmatchedResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/sku-catalog/search-unmatched?q=${encodeURIComponent(term)}`,
          { credentials: 'same-origin' },
        );
        const body = (await res.json()) as SearchUnmatchedResponse;
        if (!cancelled && body.success) setData(body);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [query]);

  // Refresh after a pair/create commit clears one of these gaps.
  useEffect(() => {
    const handler = () => setData(null);
    window.addEventListener('sku-pairing-updated', handler);
    return () => window.removeEventListener('sku-pairing-updated', handler);
  }, []);

  const term = query.trim();
  if (!term) return null;

  const unmapped = data?.unmappedPlatformIds ?? [];
  const catalogExists = data?.catalogSku.exists ?? false;
  const offerAdd = !!data && !catalogExists;

  // Nothing to show yet (still loading first pass) → keep it quiet.
  if (!data && !loading) return null;
  if (data && unmapped.length === 0 && !offerAdd) return null;

  return (
    <div className="shrink-0 border-b border-gray-200 bg-gray-50/60">
      <div className={`flex items-center justify-between ${SIDEBAR_GUTTER} py-1.5`}>
        <span className="text-micro font-black uppercase tracking-wider text-gray-500">
          Not in the queue
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
      </div>

      {/* Unmapped account-source identifiers */}
      {unmapped.length > 0 && (
        <ul className="max-h-52 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100 bg-white">
          {unmapped.map((id) => {
            const style = platformStyle(id.platform);
            // Ecwid's item id is an internal numeric product id — show its SKU
            // instead. Other platforms key on the marketplace item id (ASIN, etc.).
            const value =
              id.platform === 'ecwid'
                ? id.platformSku || id.platformItemId || ''
                : id.platformItemId || id.platformSku || '';
            return (
              <li key={id.platformIdRowId}>
                <button
                  type="button"
                  onClick={() => onPairIdentifier(id)}
                  className={`flex w-full items-center gap-2 ${SIDEBAR_GUTTER} py-2 text-left transition-colors hover:bg-blue-50`}
                >
                  <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0 text-eyebrow font-semibold uppercase tracking-wider ${style.chip}`}>
                    {style.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-bold text-gray-900">{value}</span>
                      {id.orderCount > 0 && (
                        <span className="shrink-0 text-eyebrow font-bold uppercase tracking-wider text-amber-700">
                          {id.orderCount} ord
                        </span>
                      )}
                    </div>
                    <p className="truncate text-micro text-gray-500">
                      {id.suggestedTitle || 'No linked title — unmapped'}
                    </p>
                  </div>
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add the searched Zoho SKU to the catalog */}
      {offerAdd && (
        <div className={`border-t border-gray-100 ${SIDEBAR_GUTTER} py-2`}>
          <button
            type="button"
            onClick={onAddSku}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/60 px-2.5 py-2 text-left transition-colors hover:bg-blue-50"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-bold text-blue-700">Add Zoho SKU to catalog</span>
              <span className="block truncate font-mono text-micro text-blue-500">{term}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
