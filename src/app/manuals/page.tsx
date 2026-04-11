'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Package, Loader2, Check, Link2 } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { tableHeader, microBadge } from '@/design-system/tokens/typography/presets';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkuCatalogListItem {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
  platform_count: number;
  manual_count: number;
  qc_step_count: number;
  order_count: number;
  ecwid_display_name: string | null;
  ecwid_image_url: string | null;
  ecwid_sku: string | null;
}

interface UnpairedEcwidItem {
  id: number;
  platform_sku: string | null;
  platform_item_id: string | null;
  display_name: string | null;
  image_url: string | null;
  order_count: number;
}

type Mode = 'all' | 'pairing' | 'manuals' | 'qc';

const MODE_TITLES: Record<Mode, string> = {
  all: 'Products',
  pairing: 'SKU Pairing',
  manuals: 'Manuals',
  qc: 'QC Checklist',
};

// ─── Ecwid Pairing Table ────────────────────────────────────────────────────

function EcwidPairingTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedEcwidId = searchParams.get('ecwid') ? Number(searchParams.get('ecwid')) : null;
  const query = searchParams.get('q') || '';

  const [items, setItems] = useState<UnpairedEcwidItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const autoSelected = useRef(false);

  useEffect(() => {
    let cancelled = false;
    autoSelected.current = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200' });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`/api/sku-catalog/unpaired-ecwid?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [query]);

  const handleSelect = useCallback((item: UnpairedEcwidItem) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('ecwid', String(item.id));
    params.delete('id');
    router.replace(`/manuals?${params.toString()}`);
  }, [router, searchParams]);

  // Auto-select first (most ordered) on load
  useEffect(() => {
    if (!loading && items.length > 0 && !selectedEcwidId && !autoSelected.current) {
      autoSelected.current = true;
      handleSelect(items[0]);
    }
  }, [loading, items, selectedEcwidId, handleSelect]);

  // Listen for pair events to refresh
  useEffect(() => {
    const handler = () => { autoSelected.current = false; setItems([]); setLoading(true); };
    window.addEventListener('ecwid-paired', handler);
    return () => window.removeEventListener('ecwid-paired', handler);
  }, []);

  // Re-fetch after pair event
  useEffect(() => {
    if (!loading || items.length > 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams({ limit: '200' });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`/api/sku-catalog/unpaired-ecwid?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [loading, items.length, query]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-6`}>
          <p className="truncate text-[11px] font-black uppercase tracking-[0.2em] text-gray-900">
            SKU Pairing
          </p>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            {loading ? 'Loading...' : `${total} unpaired`}
          </span>
        </div>
      </div>

      <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-gray-200 bg-white/95 px-6 backdrop-blur-sm">
        <p className={`min-w-0 flex-1 ${tableHeader}`}>Ecwid Product</p>
        <p className={`w-16 text-center ${tableHeader}`}>SKU</p>
        <p className={`w-16 text-right ${tableHeader}`}>Orders</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-8">
            <Check className="h-8 w-8 text-emerald-400 mb-2" />
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">
              {query ? 'No matches' : 'All Ecwid products paired'}
            </p>
          </div>
        ) : (
          items.map((item, idx) => {
            const isSelected = selectedEcwidId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className={`flex w-full items-center gap-3 border-b border-gray-100 px-6 py-3 text-left transition-colors ${
                  isSelected
                    ? 'bg-orange-50/60 ring-1 ring-inset ring-orange-200'
                    : idx % 2 === 0
                      ? 'bg-white hover:bg-gray-50/50'
                      : 'bg-gray-50/30 hover:bg-gray-50/70'
                }`}
              >
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="h-8 w-8 rounded-lg object-cover bg-gray-100 shrink-0" />
                ) : (
                  <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Package className="h-4 w-4 text-gray-300" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-gray-900">
                    {item.display_name || 'Unnamed Product'}
                  </p>
                </div>
                <div className="w-16 text-center">
                  <span className="text-[10px] font-mono font-bold text-gray-500">
                    {item.platform_sku || '—'}
                  </span>
                </div>
                <div className="w-16 text-right">
                  <span className={`font-mono text-[12px] font-black tabular-nums ${item.order_count > 5 ? 'text-amber-600' : 'text-gray-900'}`}>
                    {item.order_count}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Catalog Table (All / Manuals / QC modes) ──────────────────────────────

function CatalogTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') || 'all') as Mode;
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;
  const query = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'az';
  const dir = searchParams.get('dir') || 'asc';

  const [items, setItems] = useState<SkuCatalogListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const autoSelected = useRef(false);

  useEffect(() => {
    let cancelled = false;
    autoSelected.current = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '200', sort, dir });
        if (query.trim()) params.set('q', query.trim());
        if (mode === 'manuals' || mode === 'qc') params.set('ecwidOnly', 'true');
        const res = await fetch(`/api/sku-catalog?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [query, sort, dir, mode]);

  const handleSelect = useCallback((id: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('id', String(id));
    params.delete('ecwid');
    router.replace(`/manuals?${params.toString()}`);
  }, [router, searchParams]);

  useEffect(() => {
    if (!loading && items.length > 0 && !selectedId && !autoSelected.current) {
      autoSelected.current = true;
      handleSelect(items[0].id);
    }
  }, [loading, items, selectedId, handleSelect]);

  const title = MODE_TITLES[mode];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-6`}>
          <p className="truncate text-[11px] font-black uppercase tracking-[0.2em] text-gray-900">{title}</p>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            {loading ? 'Loading...' : `${total} product${total !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-gray-200 bg-white/95 px-6 backdrop-blur-sm">
        <p className={`min-w-0 flex-1 ${tableHeader}`}>Product</p>
        <p className={`w-20 text-center ${tableHeader}`}>Category</p>
        <p className={`w-20 text-center ${tableHeader}`}>Platforms</p>
        <p className={`w-20 text-center ${tableHeader}`}>Manuals</p>
        <p className={`w-16 text-center ${tableHeader}`}>QC</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-8">
            <Package className="h-8 w-8 text-gray-300 mb-2" />
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">
              {query ? 'No matches' : 'No products'}
            </p>
          </div>
        ) : (
          items.map((item, idx) => {
            const isSelected = selectedId === item.id;
            const showEcwid = mode !== 'all' && item.ecwid_display_name;
            const displayName = showEcwid ? item.ecwid_display_name! : item.product_title;
            const displaySku = showEcwid ? item.ecwid_sku || item.sku : item.sku;
            const displayImage = showEcwid ? item.ecwid_image_url : item.image_url;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`flex w-full items-center gap-3 border-b border-gray-100 px-6 py-3 text-left transition-colors ${
                  isSelected
                    ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-200'
                    : idx % 2 === 0
                      ? 'bg-white hover:bg-gray-50/50'
                      : 'bg-gray-50/30 hover:bg-gray-50/70'
                }`}
              >
                {displayImage && (
                  <img src={displayImage} alt="" className="h-8 w-8 rounded-lg object-cover bg-gray-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-gray-900">{displayName}</p>
                  <p className="truncate text-[11px] font-bold text-gray-500">{displaySku}</p>
                </div>
                <div className="w-20 flex items-center justify-center">
                  {item.category ? (
                    <span className={`${microBadge} rounded-full border px-1.5 py-0.5 bg-gray-50 text-gray-600 border-gray-200`}>
                      {item.category}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-[10px]">&mdash;</span>
                  )}
                </div>
                <div className="w-20 flex items-center justify-center">
                  {item.platform_count > 0 ? (
                    <span className={`${microBadge} rounded bg-blue-50 text-blue-600 px-1.5 py-0.5`}>{item.platform_count}</span>
                  ) : (
                    <span className="text-gray-300 text-[10px]">&mdash;</span>
                  )}
                </div>
                <div className="w-20 flex items-center justify-center">
                  {item.manual_count > 0 ? (
                    <span className={`${microBadge} rounded bg-emerald-50 text-emerald-600 px-1.5 py-0.5`}>{item.manual_count}</span>
                  ) : (
                    <span className="text-gray-300 text-[10px]">&mdash;</span>
                  )}
                </div>
                <div className="w-16 flex items-center justify-center">
                  {item.qc_step_count > 0 ? (
                    <span className={`${microBadge} rounded bg-amber-50 text-amber-600 px-1.5 py-0.5`}>{item.qc_step_count}</span>
                  ) : (
                    <span className="text-gray-300 text-[10px]">&mdash;</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Page Content ───────────────────────────────────────────────────────────

function PageContent() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') || 'all') as Mode;

  if (mode === 'pairing') return <EcwidPairingTable />;
  return <CatalogTable />;
}

export default function ManualsPage() {
  return (
    <Suspense>
      <PageContent />
    </Suspense>
  );
}
