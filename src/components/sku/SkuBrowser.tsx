'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Search, Barcode } from '@/components/Icons';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import SkuDetailView from './SkuDetailView';

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = (searchParams.get('view') === 'sku_history' ? 'sku_history' : 'sku_stock') as SkuView;
  const searchQuery = String(searchParams.get('search') || '').trim();
  const openSku = searchParams.get('sku') || null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skuStockRows, setSkuStockRows] = useState<SkuStockRow[]>([]);
  const [skuHistoryRows, setSkuHistoryRows] = useState<SkuHistoryRow[]>([]);
  const [copiedSku, setCopiedSku] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  // Barcode scanner — navigate to detail page on scan
  const {
    videoRef,
    lastScannedValue,
    startScanning,
    stopScanning,
    acceptScan,
    isScanning,
  } = useBarcodeScanner({ dedupMs: 3000 });

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

  // When a barcode is scanned, open the detail panel
  useEffect(() => {
    if (!lastScannedValue) return;
    acceptScan();
    stopScanning();
    setShowScanner(false);
    openSkuPanel(lastScannedValue);
  }, [lastScannedValue, acceptScan, stopScanning, openSkuPanel]);

  const handleOpenScanner = useCallback(async () => {
    setShowScanner(true);
    await startScanning();
  }, [startScanning]);

  const handleCloseScanner = useCallback(() => {
    setShowScanner(false);
    stopScanning();
  }, [stopScanning]);

  useEffect(() => {
    let cancelled = false;

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
      {/* ── Scan button (floating) ── */}
      <button
        onClick={handleOpenScanner}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:bg-blue-800 transition-colors"
        aria-label="Scan barcode"
      >
        <Barcode className="h-6 w-6" />
      </button>

      {/* ── Scanner overlay ── */}
      {showScanner && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
              Scan SKU Barcode
            </p>
            <button
              onClick={handleCloseScanner}
              className="h-11 w-11 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
              aria-label="Close scanner"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <video
              ref={videoRef as React.Ref<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Viewfinder */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/40" />
              <div className="relative w-[72%] max-w-[300px] aspect-square rounded-3xl border-[3px] border-white/40 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
              </div>
            </div>
          </div>
          {/* Manual entry fallback */}
          <div className="flex-shrink-0 bg-black/80 backdrop-blur-sm px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.target as HTMLFormElement).elements.namedItem('manualSku') as HTMLInputElement;
                const val = input?.value?.trim();
                if (val) {
                  handleCloseScanner();
                  openSkuPanel(val);
                }
              }}
              className="flex gap-2"
            >
              <input
                name="manualSku"
                type="text"
                placeholder="Enter SKU manually..."
                autoComplete="off"
                autoCapitalize="characters"
                className="flex-1 h-11 rounded-xl bg-white/10 border border-white/20 px-4 text-sm font-bold text-white placeholder:text-white/40 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/50"
              />
              <button
                type="submit"
                className="h-11 px-4 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:bg-blue-700"
              >
                Go
              </button>
            </form>
          </div>
        </div>
      )}

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
