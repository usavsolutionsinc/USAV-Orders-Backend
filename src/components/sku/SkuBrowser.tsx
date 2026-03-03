'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search } from '@/components/Icons';

export type SkuView = 'sku_stock' | 'sku_history';

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

export default function SkuBrowser() {
  const searchParams = useSearchParams();
  const view = (searchParams.get('view') === 'sku_history' ? 'sku_history' : 'sku_stock') as SkuView;
  const searchQuery = String(searchParams.get('search') || '').trim();
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skuStockRows, setSkuStockRows] = useState<SkuStockRow[]>([]);
  const [skuHistoryRows, setSkuHistoryRows] = useState<SkuHistoryRow[]>([]);
  const [copiedSku, setCopiedSku] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError('');
      setIsSearching(true);
      if ((view === 'sku_stock' ? skuStockRows.length : skuHistoryRows.length) === 0) {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();
        params.set('limit', '500');
        if (searchQuery) params.set('q', searchQuery);

        const endpoint = view === 'sku_stock' ? '/api/sku-stock' : '/api/sku';
        const res = await fetch(`${endpoint}?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.details || data?.error || 'Request failed');
        }

        if (cancelled) return;

        if (view === 'sku_stock') {
          setSkuStockRows(Array.isArray(data?.rows) ? data.rows : []);
        } else {
          setSkuHistoryRows(Array.isArray(data?.rows) ? data.rows : []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load SKU records');
          if (view === 'sku_stock') {
            setSkuStockRows([]);
          } else {
            setSkuHistoryRows([]);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsSearching(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [view, searchQuery]);

  const handleCopySku = async (value: string | null | undefined) => {
    const text = String(value || '').trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedSku(text);
      window.setTimeout(() => {
        setCopiedSku((current) => (current === text ? '' : current));
      }, 1200);
    } catch (error) {
      console.error('Failed to copy SKU:', error);
    }
  };

  const activeCount = view === 'sku_stock' ? skuStockRows.length : skuHistoryRows.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-2 py-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
              {view === 'sku_stock' ? 'SKU Stock' : 'SKU Database'}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">{activeCount}</span>
              {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {loading ? (
            <div className="flex h-full items-center justify-center bg-gray-50">
              <div className="text-center">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
                <p className="text-sm font-semibold text-gray-600">Loading SKU records...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center bg-gray-50 px-6 text-center">
              <p className="text-sm font-semibold text-red-600">{error}</p>
            </div>
          ) : activeCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-40 text-center">
              <div className="max-w-xs animate-in fade-in zoom-in duration-300">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <Search className="h-8 w-8 text-red-400" />
                </div>
                <h3 className="mb-1 text-lg font-black uppercase tracking-tight text-gray-900">No records found</h3>
                <p className="text-xs font-bold uppercase tracking-widest leading-relaxed text-gray-500">
                  {searchQuery ? `No ${view === 'sku_stock' ? 'stock' : 'sku'} records match "${searchQuery}"` : 'There are no records to display'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex w-full flex-col">
              {view === 'sku_stock' ? (
                <>
                  <div className="grid grid-cols-[64px_140px_minmax(220px,1fr)] items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Stock</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">SKU</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Product Title</div>
                  </div>
                  {skuStockRows.map((row, index) => (
                    <div
                      key={row.id}
                      className={`grid grid-cols-[64px_140px_minmax(220px,1fr)] items-center gap-1 border-b border-gray-50 px-2 py-1.5 ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                      }`}
                    >
                      <div className="text-[12px] font-bold text-gray-900">
                        {String(row.stock ?? '').trim() || '0'}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopySku(row.sku)}
                        className="truncate text-left text-[12px] font-bold text-gray-900 hover:text-blue-600"
                        title="Click to copy SKU"
                      >
                        {copiedSku === String(row.sku || '').trim()
                          ? `${String(row.sku ?? '').trim() || '—'} copied`
                          : String(row.sku ?? '').trim() || '—'}
                      </button>
                      <div className="text-[12px] font-bold text-gray-900 truncate">
                        {String(row.product_title ?? '').trim() || '—'}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-[156px_140px_minmax(180px,1fr)_180px_88px_150px_200px] items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Updated</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">SKU</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Product Title</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Serial Number</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Location</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Tracking</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Notes</div>
                  </div>
                  {skuHistoryRows.map((row, index) => (
                    <div
                      key={row.id}
                      className={`grid grid-cols-[156px_140px_minmax(180px,1fr)_180px_88px_150px_200px] items-center gap-1 border-b border-gray-50 px-2 py-1.5 ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                      }`}
                    >
                      <div className="text-[11px] font-bold text-gray-500">
                        {String(row.updated_at ?? '').trim() || '—'}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopySku(row.static_sku)}
                        className="truncate text-left text-[12px] font-bold text-gray-900 hover:text-blue-600"
                        title="Click to copy SKU"
                      >
                        {copiedSku === String(row.static_sku || '').trim()
                          ? `${String(row.static_sku ?? '').trim() || '—'} copied`
                          : String(row.static_sku ?? '').trim() || '—'}
                      </button>
                      <div className="truncate text-[12px] font-bold text-gray-900">
                        {String(row.product_title ?? '').trim() || '—'}
                      </div>
                      <div className="truncate text-[11px] font-bold text-gray-500">
                        {String(row.serial_number ?? '').trim() || '—'}
                      </div>
                      <div className="truncate text-[11px] font-bold uppercase tracking-widest text-gray-500">
                        {String(row.location ?? '').trim() || '—'}
                      </div>
                      <div className="truncate text-[11px] font-bold text-gray-500">
                        {String(row.shipping_tracking_number ?? '').trim() || '—'}
                      </div>
                      <div className="truncate text-[11px] font-bold text-gray-500">
                        {String(row.notes ?? '').trim() || '—'}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
