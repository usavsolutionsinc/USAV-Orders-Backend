'use client';

/**
 * Sidebar finder for SKUs (by SKU code or product title) and bin barcodes.
 *
 * Heuristic: anything matching ROOM-ROW-COL (two dashes, no spaces) is
 * treated as a bin barcode and routes directly to /bin/[barcode]. Everything
 * else hits /api/inventory/sku-search which matches against sku AND
 * product_title.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';

interface SkuHit {
  sku: string;
  product_title: string | null;
  stock: number;
  bin_count: number;
  total_qty: number;
}

function looksLikeBinBarcode(v: string): boolean {
  const trimmed = v.trim();
  if (!trimmed) return false;
  return /^[^\s]+-[^\s-]+-[^\s-]+$/.test(trimmed);
}

export function SkuLocationFinder() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [hits, setHits] = useState<SkuHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/inventory/sku-search?q=${encodeURIComponent(q)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (res.ok) {
        setHits(Array.isArray(data?.results) ? data.results : []);
      } else {
        setHits([]);
      }
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!value.trim()) {
      setHits(null);
      return;
    }
    if (looksLikeBinBarcode(value)) {
      setHits(null);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(value.trim());
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, runSearch]);

  const handleSearch = useCallback((submitted: string) => {
    const trimmed = submitted.trim();
    if (!trimmed) return;
    if (looksLikeBinBarcode(trimmed)) {
      router.push(`/bin/${encodeURIComponent(trimmed)}`);
      setOpen(false);
      return;
    }
    void runSearch(trimmed);
    setOpen(true);
  }, [router, runSearch]);

  const handleClear = useCallback(() => {
    setValue('');
    setHits(null);
    setOpen(false);
  }, []);

  return (
    <div className="space-y-2">
      <SearchBar
        value={value}
        onChange={(v) => { setValue(v); setOpen(true); }}
        onSearch={handleSearch}
        onClear={handleClear}
        placeholder="Find product, SKU, or bin barcode…"
        variant="blue"
        size="compact"
        hideUnderline
        isSearching={loading}
      />

      {open && value.trim() && !looksLikeBinBarcode(value) && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loading && (
            <div className="px-3 py-3 text-xs text-gray-400">Searching…</div>
          )}
          {!loading && hits && hits.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-500">
              No SKUs or products match.
            </div>
          )}
          {!loading && hits && hits.length > 0 && (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.sku}>
                  <Link
                    href={`/inventory?sku=${encodeURIComponent(h.sku)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-baseline justify-between gap-2 px-3 py-2 transition-colors hover:bg-gray-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-blue-700">
                        {h.sku}
                      </div>
                      {h.product_title && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-gray-600">
                          {h.product_title}
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px] text-gray-400">
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
          )}
        </div>
      )}
    </div>
  );
}
