'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Check, X, Loader2, AlertCircle, Link2, Unlink } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { tableHeader, microBadge } from '@/design-system/tokens/typography/presets';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UnpairedItem {
  item_number: string;
  account_source: string | null;
  product_title: string | null;
  sku: string | null;
  order_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

interface SkuCatalogResult {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  upc: string | null;
  image_url: string | null;
  platform_ids: Array<{
    platform: string;
    platform_sku: string | null;
    platform_item_id: string | null;
    account_name: string | null;
  }>;
}

// ─── Platform label helper ───────────────────────────────────────────────────

function platformLabel(accountSource: string | null): string {
  const src = (accountSource || '').toLowerCase().trim();
  if (src.startsWith('ebay')) return 'eBay';
  if (src === 'amazon' || src === 'fba') return 'Amazon';
  if (src === 'walmart') return 'Walmart';
  if (src === 'ecwid') return 'Ecwid';
  return src || 'Unknown';
}

function platformColor(accountSource: string | null): string {
  const src = (accountSource || '').toLowerCase().trim();
  if (src.startsWith('ebay')) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  if (src === 'amazon' || src === 'fba') return 'bg-orange-100 text-orange-700 border-orange-200';
  if (src === 'walmart') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (src === 'ecwid') return 'bg-purple-100 text-purple-700 border-purple-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

// ─── Row animation ───────────────────────────────────────────────────────────

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 28 } },
  exit: { opacity: 0, x: -16, transition: { duration: 0.14 } },
};

// ─── Component ───────────────────────────────────────────────────────────────

interface SkuPairingPanelProps {
  onSelectItem?: (item: UnpairedItem | null) => void;
  selectedItemNumber?: string | null;
  /** When true, hides the built-in search header (parent provides it). */
  embedded?: boolean;
}

export function SkuPairingPanel({ onSelectItem, selectedItemNumber, embedded = false }: SkuPairingPanelProps) {
  const [unpaired, setUnpaired] = useState<UnpairedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [internalSelected, setInternalSelected] = useState<string | null>(null);

  const activeItemNumber = selectedItemNumber ?? internalSelected;

  // Listen for external search events (from ManualsCombinedSidebar)
  useEffect(() => {
    if (!embedded) return;
    const handler = (e: CustomEvent<string>) => setSearchQuery(e.detail ?? '');
    window.addEventListener('sku-pairing-search' as any, handler as any);
    return () => window.removeEventListener('sku-pairing-search' as any, handler as any);
  }, [embedded]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  // Fetch unpaired items
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200' });
        if (debouncedQuery) params.set('q', debouncedQuery);
        const res = await fetch(`/api/sku-catalog/unpaired?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setUnpaired(data.items || []);
          setTotal(data.total || 0);
        }
      } catch {
        if (!cancelled) setUnpaired([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [debouncedQuery, refreshKey]);

  // Listen for pair events to refresh
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener('sku-pairing-updated', handler);
    return () => window.removeEventListener('sku-pairing-updated', handler);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header — hidden when embedded in ManualsCombinedSidebar */}
      {!embedded && (
        <div className={sidebarHeaderBandClass}>
          <div className="flex min-h-[44px] items-center gap-2 px-3 py-1">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search unpaired items..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-[11px] font-bold text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </div>
      )}

      {/* Count bar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
        <p className={`${tableHeader} text-gray-500`}>
          {loading ? 'Loading...' : `${total} need pairing`}
        </p>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className={`${microBadge} px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors`}
        >
          Refresh
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-b border-gray-50 px-3 py-3">
                <div className="h-3 w-32 rounded bg-gray-100 animate-pulse" />
                <div className="mt-1.5 h-2.5 w-48 rounded bg-gray-50 animate-pulse" />
              </div>
            ))}
          </div>
        ) : unpaired.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-emerald-200 bg-emerald-50">
              <Check className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-700">
              {debouncedQuery ? 'No matches' : 'All paired'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {debouncedQuery ? 'Try a different search term.' : 'Every item number has a Zoho SKU pairing.'}
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {unpaired.map((item, idx) => {
              const isSelected = activeItemNumber === item.item_number;
              return (
                <motion.button
                  key={`${item.item_number}-${item.account_source}`}
                  type="button"
                  variants={rowVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ delay: idx * 0.02 }}
                  layout
                  onClick={() => {
                    const next = isSelected ? null : item;
                    setInternalSelected(next?.item_number ?? null);
                    onSelectItem?.(next);
                    window.dispatchEvent(new CustomEvent('sku-pairing-select-item', { detail: next }));
                  }}
                  className={`w-full text-left border-b border-gray-50 px-3 py-2.5 transition-colors ${
                    isSelected
                      ? 'bg-blue-50 border-l-2 border-l-blue-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 ${microBadge} ${platformColor(item.account_source)}`}>
                      {platformLabel(item.account_source)}
                    </span>
                    <span className="truncate text-[11px] font-mono font-bold text-gray-900">
                      {item.item_number}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-gray-500">
                    <span className="truncate">{item.product_title || 'No title'}</span>
                    <span className="shrink-0 opacity-40">-</span>
                    <span className="shrink-0">{item.order_count} order{item.order_count !== 1 ? 's' : ''}</span>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel (right side) ───────────────────────────────────────────────

interface SkuPairingDetailProps {
  item: UnpairedItem;
  onClose: () => void;
  onPaired: () => void;
}

export function SkuPairingDetail({ item, onClose, onPaired }: SkuPairingDetailProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SkuCatalogResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState<SkuCatalogResult | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairResult, setPairResult] = useState<{ ordersUpdated: number; manualsUpdated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-search with product title
  useEffect(() => {
    if (item.product_title) {
      const words = item.product_title.split(/\s+/).slice(0, 2).join(' ');
      setSearchQuery(words);
    }
  }, [item.product_title]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!searchQuery.trim()) { setResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/sku-catalog/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20`);
        const data = await res.json();
        if (data.success) setResults(data.items || []);
      } catch { /* ignore */ }
      setSearching(false);
    }, 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  const handlePair = useCallback(async () => {
    if (!selectedCatalog) return;
    setPairing(true);
    setError(null);
    try {
      const platform = platformLabel(item.account_source).toLowerCase().replace(/\s/g, '_');
      const res = await fetch('/api/sku-catalog/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuCatalogId: selectedCatalog.id,
          itemNumber: item.item_number,
          platform,
          accountName: item.account_source || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Pairing failed');
      setPairResult({ ordersUpdated: data.ordersUpdated, manualsUpdated: data.manualsUpdated });
      window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
      onPaired();
    } catch (err: any) {
      setError(err?.message || 'Failed to pair');
    } finally {
      setPairing(false);
    }
  }, [selectedCatalog, item, onPaired]);

  // Success state
  if (pairResult) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-center px-8">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.1 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <Link2 className="h-8 w-8 text-emerald-600" />
          </motion.div>
          <p className="text-[15px] font-black uppercase tracking-tight text-gray-900">Paired Successfully</p>
          <p className="mt-1 text-[12px] font-bold text-gray-400">
            {pairResult.ordersUpdated} order{pairResult.ordersUpdated !== 1 ? 's' : ''} updated
            {pairResult.manualsUpdated > 0 ? ` - ${pairResult.manualsUpdated} manual${pairResult.manualsUpdated !== 1 ? 's' : ''} linked` : ''}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-full border border-gray-200 px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-50"
          >
            Done
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`shrink-0 rounded-full border px-2 py-0.5 ${microBadge} ${platformColor(item.account_source)}`}>
                {platformLabel(item.account_source)}
              </span>
              <span className={`${tableHeader} text-gray-400`}>Needs pairing</span>
            </div>
            <h2 className="mt-2 text-[15px] font-black tracking-tight text-gray-900">
              {item.item_number}
            </h2>
            <p className="mt-0.5 text-[11px] font-semibold text-gray-500 truncate">
              {item.product_title || 'No product title'}
            </p>
            <p className="mt-1 text-[10px] font-bold text-gray-400">
              {item.order_count} order{item.order_count !== 1 ? 's' : ''}
              {item.sku ? ` - Current SKU: ${item.sku}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-gray-200 bg-white p-2 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Search Zoho products */}
      <div className="shrink-0 border-b border-gray-100 px-4 py-3">
        <p className={`${tableHeader} mb-2 text-gray-500`}>Search Zoho Products</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelectedCatalog(null); }}
            placeholder="Search by SKU or product name..."
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-[11px] font-bold text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />}
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-red-100 bg-red-50 px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-red-700">
              <AlertCircle className="h-3 w-3" />{error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && searchQuery.trim() && !searching ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-[11px] font-bold text-gray-400">No Zoho products found</p>
            <p className="mt-1 text-[10px] text-gray-400">Try a different search term.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {results.map((catalog, idx) => {
              const isSelected = selectedCatalog?.id === catalog.id;
              return (
                <motion.button
                  key={catalog.id}
                  type="button"
                  variants={rowVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ delay: idx * 0.02 }}
                  layout
                  onClick={() => setSelectedCatalog(isSelected ? null : catalog)}
                  className={`w-full text-left border-b border-gray-50 px-4 py-3 transition-colors ${
                    isSelected
                      ? 'bg-emerald-50 border-l-2 border-l-emerald-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    <span className="text-[12px] font-black text-gray-900">{catalog.sku}</span>
                    {catalog.category && (
                      <span className={`${microBadge} shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-gray-500`}>
                        {catalog.category}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-gray-600">
                    {catalog.product_title}
                  </p>
                  {catalog.platform_ids.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {catalog.platform_ids.map((pid, i) => (
                        <span key={i} className={`${microBadge} rounded border px-1.5 py-0.5 bg-gray-50 text-gray-500 border-gray-200`}>
                          {pid.platform}: {pid.platform_item_id || pid.platform_sku || '—'}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Pair button */}
      {selectedCatalog && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="shrink-0 border-t border-gray-200 bg-white px-4 py-3"
        >
          <div className="mb-2 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2">
            <p className="text-[10px] font-bold text-emerald-700">
              Pair <span className="font-mono">{item.item_number}</span> ({platformLabel(item.account_source)})
              {' '}&rarr;{' '}
              <span className="font-mono">{selectedCatalog.sku}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handlePair}
            disabled={pairing}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Pair SKU
          </button>
        </motion.div>
      )}
    </div>
  );
}
