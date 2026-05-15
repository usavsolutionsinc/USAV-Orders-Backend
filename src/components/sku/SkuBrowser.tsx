'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Search } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import SkuDetailView from './SkuDetailView';

export type SkuView = 'sku_stock' | 'sku_history' | 'location';

function parseSkuView(raw: string | null): SkuView {
  if (raw === 'sku_history') return 'sku_history';
  if (raw === 'location') return 'location';
  return 'sku_stock';
}

export { parseSkuView };

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: SkuView = parseSkuView(searchParams.get('view'));
  const searchQuery = String(searchParams.get('search') || '').trim();
  const openSku = searchParams.get('sku') || null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skuStockRows, setSkuStockRows] = useState<SkuStockRow[]>([]);
  const [skuHistoryRows, setSkuHistoryRows] = useState<SkuHistoryRow[]>([]);
  const [copiedSku, setCopiedSku] = useState('');

  const openSkuPanel = useCallback((skuValue: string) => {
    const s = skuValue.trim();
    if (!s) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('sku', s);
    router.replace(`/sku-stock?${nextParams.toString()}`);
  }, [router, searchParams]);

  const closeSkuPanel = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sku');
    const qs = nextParams.toString();
    router.replace(qs ? `/sku-stock?${qs}` : '/sku-stock');
  }, [router, searchParams]);

  // SKU camera scan opens from Quick tools FAB via `GlobalDesktopSkuScanner`.

  useEffect(() => {
    let cancelled = false;

    // Location view has no list endpoint — the active bin is loaded by the
    // dedicated /sku-stock/location/[barcode] page. The empty state here just
    // prompts the user to scan/enter a barcode.
    if (view === 'location') {
      setLoading(false);
      setError('');
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      setError('');
      if ((view === 'sku_stock' ? skuStockRows.length : skuHistoryRows.length) === 0) {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();
        params.set('limit', '500');
        if (searchQuery) params.set('q', searchQuery);

        const endpoint = view === 'sku_stock' ? '/api/sku-stock' : '/api/sku';
        const res = await fetch(`${endpoint}?${params.toString()}`);
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

    // Fill the barcode panel on the left and auto-trigger its search
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku: text } }));

    try {
      await navigator.clipboard.writeText(text);
      setCopiedSku(text);
      window.setTimeout(() => {
        setCopiedSku((current) => (current === text ? '' : current));
      }, 1200);
    } catch {
      // clipboard denied — the fill still happened via the event
    }
  };

  // Open detail panel on row click
  const handleRowClick = (skuValue: string | null) => {
    const s = String(skuValue || '').trim();
    if (!s) return;
    openSkuPanel(s);
  };

  const activeCount = view === 'sku_stock' ? skuStockRows.length : skuHistoryRows.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          ) : view === 'location' ? (
            <LocationEmptyState />
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
                    <div className={sectionLabel}>Stock</div>
                    <div className={sectionLabel}>Stock SKU</div>
                    <div className={sectionLabel}>Product Title</div>
                  </div>
                  {skuStockRows.map((row, index) => (
                    <div
                      key={row.id}
                      onClick={() => handleRowClick(row.sku)}
                      className={`grid grid-cols-[64px_140px_minmax(220px,1fr)] items-center gap-1 border-b border-gray-50 px-2 py-1.5 cursor-pointer hover:bg-blue-50/60 transition-colors ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                      }`}
                    >
                      <div className="text-[12px] font-bold text-gray-900">
                        {String(row.stock ?? '').trim() || '0'}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopySku(row.sku)}
                        className="truncate text-left text-[12px] font-bold text-gray-900 hover:text-blue-600 transition-colors"
                        title="Click to fill barcode panel"
                      >
                        {copiedSku === String(row.sku || '').trim()
                          ? <span className="text-blue-600">↑ filled</span>
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
                    <div className={sectionLabel}>Updated</div>
                    <div className={sectionLabel}>SKU</div>
                    <div className={sectionLabel}>Product Title</div>
                    <div className={sectionLabel}>Serial Number</div>
                    <div className={sectionLabel}>Location</div>
                    <div className={sectionLabel}>Tracking</div>
                    <div className={sectionLabel}>Notes</div>
                  </div>
                  {skuHistoryRows.map((row, index) => (
                    <div
                      key={row.id}
                      onClick={() => handleRowClick(row.static_sku)}
                      className={`grid grid-cols-[156px_140px_minmax(180px,1fr)_180px_88px_150px_200px] items-center gap-1 border-b border-gray-50 px-2 py-1.5 cursor-pointer hover:bg-blue-50/60 transition-colors ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                      }`}
                    >
                      <div className="text-[11px] font-bold text-gray-500">
                        {String(row.updated_at ?? '').trim() || '—'}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopySku(row.static_sku)}
                        className="truncate text-left text-[12px] font-bold text-gray-900 hover:text-blue-600 transition-colors"
                        title="Click to fill barcode panel"
                      >
                        {copiedSku === String(row.static_sku || '').trim()
                          ? <span className="text-blue-600">↑ filled</span>
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

      {/* ── Detail panel overlay ── */}
      <AnimatePresence>
        {openSku && (
          <SkuDetailView
            key={openSku}
            sku={decodeURIComponent(openSku)}
            variant="panel"
            onClose={closeSkuPanel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Location empty state ──────────────────────────────────────────────────

function LocationEmptyState() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const submit = useCallback(() => {
    const code = value.trim();
    if (!code) return;
    router.push(`/sku-stock/location/${encodeURIComponent(code)}`);
  }, [router, value]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Search className="h-8 w-8 text-blue-400" />
        </div>
        <h3 className="mb-1 text-lg font-black uppercase tracking-tight text-gray-900">
          Scan a bin label
        </h3>
        <p className="mb-6 text-xs font-bold uppercase tracking-widest leading-relaxed text-gray-500">
          Open this page from a bin QR, or type a barcode below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex w-full items-stretch gap-2"
        >
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoFocus
            placeholder="Bin barcode (e.g. Z1-A-03)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-3 text-center font-mono text-base font-bold text-gray-900 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
          >
            Open
          </button>
        </form>
      </div>
    </div>
  );
}
