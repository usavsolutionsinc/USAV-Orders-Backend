'use client';

import Link from 'next/link';
import type { SkuHit } from '@/hooks/useWarehouseSkuSearch';

interface WarehouseSkuSearchResultsProps {
  loading: boolean;
  hits: SkuHit[] | null;
  onSelect: () => void;
}

export function WarehouseSkuSearchResults({
  loading,
  hits,
  onSelect,
}: WarehouseSkuSearchResultsProps) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="px-3 py-3 text-xs text-gray-400">Searching…</div>
      </div>
    );
  }

  if (hits && hits.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="px-3 py-3 text-xs text-gray-500">
          No SKUs or products match.
        </div>
      </div>
    );
  }

  if (hits && hits.length > 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
        <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.sku}>
              <Link
                href={`/inventory?sku=${encodeURIComponent(h.sku)}`}
                onClick={onSelect}
                className="flex items-baseline justify-between gap-2 px-3 py-2 transition-colors hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-blue-700">
                    {h.sku}
                  </div>
                  {h.product_title && (
                    <div className="mt-0.5 line-clamp-1 text-caption text-gray-600">
                      {h.product_title}
                    </div>
                  )}
                  <div className="mt-0.5 text-micro text-gray-400">
                    {h.bin_count} bin{h.bin_count === 1 ? '' : 's'} ·{' '}
                    {h.total_qty} unit{h.total_qty === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-sm font-semibold tabular-nums text-gray-900">
                  {h.stock}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}
