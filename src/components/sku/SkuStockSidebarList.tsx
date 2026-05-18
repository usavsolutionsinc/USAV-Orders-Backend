'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, MapPin, Search } from '@/components/Icons';
import { SkuScanRefChip, TrackingChip, SerialChip } from '@/components/ui/CopyChip';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { parseSkuView, type SkuView } from '@/components/sku/SkuBrowser';

type SkuStockRow = {
  id: number;
  stock: string | null;
  sku: string | null;
  product_title: string | null;
};

type SkuHistoryRow = {
  id: number;
  updated_at: string | null;
  static_sku: string | null;
  product_title: string | null;
  serial_number: string | null;
  location: string | null;
  shipping_tracking_number: string | null;
  notes: string | null;
};

function stockClassFor(value: string | null | undefined): string {
  const n = parseInt(String(value ?? '').trim() || '0', 10) || 0;
  if (n <= 0) return 'text-red-600 bg-red-50/60';
  if (n <= 5) return 'text-amber-600';
  return 'text-gray-900';
}

function parseTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelative(raw: string | null): string {
  const date = parseTimestamp(raw);
  if (!date) return '—';
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dispatchSkuFill(sku: string) {
  const trimmed = String(sku || '').trim();
  if (!trimmed) return;
  window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku: trimmed } }));
}

/**
 * Compact search-driven list of SKU stock or history rows for the sidebar.
 * Replaces the right-pane `SkuBrowser` table now that the right pane hosts
 * the workspace. Row click dispatches `sku:fill`, which the workspace listens
 * for and uses to populate Step 1 instantly.
 */
export function SkuStockSidebarList() {
  const searchParams = useSearchParams();
  const view: SkuView = parseSkuView(searchParams.get('view'));
  const searchQuery = String(searchParams.get('search') || '').trim();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stockRows, setStockRows] = useState<SkuStockRow[]>([]);
  const [historyRows, setHistoryRows] = useState<SkuHistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (view === 'location') {
      setLoading(false);
      setError('');
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', '200');
        if (searchQuery) params.set('q', searchQuery);
        const endpoint = view === 'sku_stock' ? '/api/sku-stock' : '/api/sku';
        const res = await fetch(`${endpoint}?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.details || data?.error || 'Request failed');
        if (cancelled) return;
        if (view === 'sku_stock') setStockRows(Array.isArray(data?.rows) ? data.rows : []);
        else setHistoryRows(Array.isArray(data?.rows) ? data.rows : []);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load');
          if (view === 'sku_stock') setStockRows([]);
          else setHistoryRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [view, searchQuery]);

  const isEmpty = useMemo(() => {
    if (view === 'sku_stock') return stockRows.length === 0;
    if (view === 'sku_history') return historyRows.length === 0;
    return true;
  }, [view, stockRows.length, historyRows.length]);

  if (view === 'location') {
    return (
      <div className="px-4 py-6 text-center">
        <Search className="mx-auto mb-2 h-5 w-5 text-blue-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Scan a bin barcode in the search above
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center px-4 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-4 text-center text-[11px] font-bold text-red-600">{error}</div>
    );
  }

  if (isEmpty) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          {searchQuery ? `No match for "${searchQuery}"` : 'No records'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-1.5">
        <span className={sectionLabel}>
          {view === 'sku_stock' ? 'Stock' : 'Activity'}
        </span>
      </div>

      {view === 'sku_stock'
        ? stockRows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              onClick={() => dispatchSkuFill(row.sku || '')}
              className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-100 px-3 py-2 text-left transition-colors hover:bg-blue-50/60 ${
                index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
              }`}
            >
              <span
                className={`text-[13px] font-black tabular-nums ${stockClassFor(row.stock)}`}
              >
                {parseInt(String(row.stock ?? '').trim() || '0', 10) || 0}
              </span>
              <span className="truncate text-[11px] font-bold text-gray-900">
                {String(row.product_title ?? '').trim() || '—'}
              </span>
              <SkuScanRefChip
                value={String(row.sku ?? '')}
                display={String(row.sku ?? '—')}
                onCopy={dispatchSkuFill}
              />
            </button>
          ))
        : historyRows.map((row, index) => {
            const relative = formatRelative(row.updated_at);
            const tracking = String(row.shipping_tracking_number || '').trim();
            const location = String(row.location || '').trim();
            const serial = String(row.serial_number || '').trim();
            const sku = String(row.static_sku ?? '');
            const title = String(row.product_title ?? '').trim() || 'Unknown';
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => dispatchSkuFill(sku)}
                className={`flex flex-col gap-1 border-b border-gray-100 px-3 py-2 text-left transition-colors hover:bg-blue-50/60 ${
                  index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[9px] font-black uppercase tracking-widest tabular-nums text-gray-500">
                    {relative}
                  </span>
                  <span className="truncate text-[11px] font-bold text-gray-900">{title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <SkuScanRefChip value={sku} display={sku || '—'} onCopy={dispatchSkuFill} />
                  {serial ? <SerialChip value={serial} display={serial} /> : null}
                  {location ? (
                    <span className="inline-flex items-center gap-1 px-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                      <MapPin className="h-3 w-3" />
                      {location}
                    </span>
                  ) : null}
                  {tracking ? <TrackingChip value={tracking} display={tracking} /> : null}
                </div>
              </button>
            );
          })}
    </div>
  );
}

export default SkuStockSidebarList;
