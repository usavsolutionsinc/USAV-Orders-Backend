'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Link2, FileText, Check, Loader2, Package, ExternalLink, Search } from '@/components/Icons';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { microBadge, tableHeader } from '@/design-system/tokens/typography/presets';
import { getExternalUrlByPlatform, getPlatformLabelByItemNumber } from '@/hooks/useExternalItemUrl';
import { getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';
import { PairingSection } from '@/components/manuals/sections/PairingSection';
import { ManualsSection } from '@/components/manuals/sections/ManualsSection';
import { QcChecklistSection } from '@/components/manuals/sections/QcChecklistSection';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkuCatalogDetail {
  catalog: {
    id: number;
    sku: string;
    product_title: string;
    category: string | null;
    image_url: string | null;
    upc: string | null;
  };
  platformIds: Array<{
    id: number;
    platform: string;
    platform_sku: string | null;
    platform_item_id: string | null;
    account_name: string | null;
  }>;
  manuals: Array<{
    id: number;
    display_name: string | null;
    google_file_id: string;
    type: string | null;
    updated_at: string | null;
  }>;
  qcChecks: Array<{
    id: number;
    step_label: string;
    step_type: string;
    sort_order: number;
  }>;
}

interface UnpairedEcwidItem {
  id: number;
  platform_sku: string | null;
  platform_item_id: string | null;
  display_name: string | null;
  image_url: string | null;
  order_count: number;
}

interface ZohoSearchResult {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
}

interface ZohoSuggestion extends ZohoSearchResult {
  similarity: number;
}

// ─── Slider items ───────────────────────────────────────────────────────────

const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', tone: 'zinc' },
  { id: 'pairing', label: 'SKU Pairing', tone: 'orange' },
  { id: 'manuals', label: 'Manuals', tone: 'emerald' },
  { id: 'qc', label: 'QC Checklist', tone: 'blue' },
];

const SORT_ITEMS: HorizontalSliderItem[] = [
  { id: 'az', label: 'A-Z', tone: 'zinc' },
  { id: 'ordered', label: 'Most Ordered', tone: 'yellow' },
  { id: 'shipped', label: 'Recently Shipped', tone: 'emerald' },
];

// ─── Accordion Section ─────────────────────────────────────────────────────

function AccordionSection({
  title, count, icon, tone = 'gray', defaultOpen = false, children,
}: {
  title: string; count: number; icon: React.ReactNode;
  tone?: 'blue' | 'emerald' | 'amber' | 'gray'; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toneClass = { blue: 'text-blue-600', emerald: 'text-emerald-600', amber: 'text-amber-600', gray: 'text-gray-600' }[tone];

  return (
    <div className="border-t border-gray-100">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
        <span className={toneClass}>{icon}</span>
        <span className={`flex-1 ${tableHeader} text-gray-700`}>{title}</span>
        <span className={`${microBadge} rounded-full px-1.5 py-0.5 bg-gray-100 text-gray-500`}>{count}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Selected Product Banner (for All/Manuals/QC modes) ─────────────────────

function SelectedBanner({ detail }: { detail: SkuCatalogDetail }) {
  const { catalog, platformIds } = detail;

  const externalLinks = platformIds
    .map((pid) => {
      const identifier = pid.platform_sku || pid.platform_item_id;
      if (!identifier) return null;
      const dbLabel = (pid.platform || '').toLowerCase();
      // Use platform_sku for ecwid URL (not the internal product id)
      const urlId = dbLabel === 'ecwid' ? (pid.platform_sku || pid.platform_item_id) : identifier;
      const url = getExternalUrlByPlatform(pid.platform, urlId!);
      if (!url) return null;
      const inferred = getPlatformLabelByItemNumber(identifier);
      const label = dbLabel === 'zoho' ? 'Ecwid'
        : (dbLabel === 'unknown' || !dbLabel) ? inferred : pid.platform;
      return { label, url };
    })
    .filter(Boolean) as Array<{ label: string; url: string }>;

  const uniqueLinks = externalLinks.filter((link, i, arr) => arr.findIndex((l) => l.label === link.label) === i);

  return (
    <div className="shrink-0 border-b border-gray-200 bg-blue-50/50 px-3 py-3">
      <div className="flex items-start gap-2.5">
        {catalog.image_url && (
          <img src={catalog.image_url} alt="" className="h-9 w-9 rounded-lg object-cover bg-gray-100 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black tracking-tight text-gray-900">
            {catalog.sku} <span className="text-[9px] font-bold text-gray-400">— ZOHO</span>
          </p>
          <p className="text-[10px] font-semibold text-gray-500">{catalog.product_title}</p>
          {catalog.category && (
            <span className={`inline-block mt-1 ${microBadge} rounded-full border px-1.5 py-0.5 bg-white text-gray-600 border-gray-200`}>
              {catalog.category}
            </span>
          )}
        </div>
      </div>
      {uniqueLinks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {uniqueLinks.map((link) => {
            const colorCls = getOrderPlatformColor(link.label);
            const borderCls = getOrderPlatformBorderColor(link.label);
            return (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 ${microBadge} bg-white ${colorCls} ${borderCls} hover:bg-gray-50 transition-colors`}>
                <ExternalLink className="h-2.5 w-2.5" />
                {link.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Ecwid Pairing Panel (for SKU Pairing mode) ────────────────────────────

function EcwidPairingPanel({
  ecwidRowId,
  updateParams,
}: {
  ecwidRowId: number;
  updateParams: (updates: Record<string, string | null>) => void;
}) {
  const [ecwidItem, setEcwidItem] = useState<UnpairedEcwidItem | null>(null);
  const [loadingEcwid, setLoadingEcwid] = useState(true);
  const [zohoQuery, setZohoQuery] = useState('');
  const [zohoResults, setZohoResults] = useState<ZohoSearchResult[]>([]);
  const [searchingZoho, setSearchingZoho] = useState(false);
  const [selectedZohoId, setSelectedZohoId] = useState<number | null>(null);
  const [pairing, setPairing] = useState(false);
  const [paired, setPaired] = useState(false);
  const [suggestions, setSuggestions] = useState<ZohoSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the Ecwid item details + trigram suggestions in parallel
  useEffect(() => {
    let cancelled = false;
    setLoadingEcwid(true);
    setLoadingSuggestions(true);
    setPaired(false);
    setSelectedZohoId(null);
    setZohoQuery('');
    setZohoResults([]);
    setSuggestions([]);
    const load = async () => {
      try {
        const [ecwidRes, suggestRes] = await Promise.all([
          fetch(`/api/sku-catalog/unpaired-ecwid?limit=500`),
          fetch(`/api/sku-catalog/pair-suggestions?ecwidId=${ecwidRowId}&limit=5`),
        ]);
        const ecwidData = await ecwidRes.json();
        const suggestData = await suggestRes.json();
        if (cancelled) return;
        const found = (ecwidData.items || []).find((i: UnpairedEcwidItem) => i.id === ecwidRowId);
        setEcwidItem(found || null);
        if (found?.display_name) {
          const words = found.display_name.split(/\s+/).slice(0, 3).join(' ');
          setZohoQuery(words);
        }
        if (suggestData.success) setSuggestions(suggestData.items || []);
      } catch { /* ignore */ }
      if (!cancelled) {
        setLoadingEcwid(false);
        setLoadingSuggestions(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [ecwidRowId]);

  // Debounced Zoho catalog search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!zohoQuery.trim()) { setZohoResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchingZoho(true);
      try {
        const res = await fetch(`/api/sku-catalog?q=${encodeURIComponent(zohoQuery.trim())}&limit=20`);
        const data = await res.json();
        if (data.success) setZohoResults(data.items || []);
      } catch { /* ignore */ }
      setSearchingZoho(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [zohoQuery]);

  const handlePair = useCallback(async () => {
    if (!selectedZohoId) return;
    setPairing(true);
    try {
      const res = await fetch('/api/sku-catalog/pair-ecwid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ecwidPlatformRowId: ecwidRowId, skuCatalogId: selectedZohoId }),
      });
      const data = await res.json();
      if (data.success) {
        setPaired(true);
        window.dispatchEvent(new CustomEvent('ecwid-paired'));
      }
    } finally {
      setPairing(false);
    }
  }, [ecwidRowId, selectedZohoId]);

  if (loadingEcwid) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!ecwidItem) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-[10px] font-bold text-gray-400">Ecwid product not found or already paired</p>
      </div>
    );
  }

  if (paired) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
          <Link2 className="h-6 w-6 text-emerald-600" />
        </motion.div>
        <p className="text-[13px] font-black text-gray-900">Paired Successfully</p>
        <p className="mt-1 text-[10px] font-semibold text-gray-400">{ecwidItem.display_name}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Ecwid product banner */}
      <div className="shrink-0 border-b border-gray-200 bg-orange-50/50 px-3 py-3">
        <div className="flex items-start gap-2.5">
          {ecwidItem.image_url ? (
            <img src={ecwidItem.image_url} alt="" className="h-9 w-9 rounded-lg object-cover bg-gray-100 shrink-0" />
          ) : (
            <div className="h-9 w-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <Package className="h-4 w-4 text-orange-500" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-black tracking-tight text-gray-900">{ecwidItem.display_name || 'Unnamed'}</p>
            <p className="text-[10px] font-mono font-bold text-gray-500">Ecwid SKU: {ecwidItem.platform_sku || '—'}</p>
            <p className="text-[10px] font-semibold text-gray-400">{ecwidItem.order_count} order{ecwidItem.order_count !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Trigram suggestions (click-to-pair) */}
      {(loadingSuggestions || suggestions.length > 0) && (
        <div className="shrink-0 border-b border-gray-100 px-3 py-2.5">
          <p className={`${tableHeader} mb-1.5 text-gray-500`}>Suggested Zoho Matches</p>
          {loadingSuggestions ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-1">
              {suggestions.map((sug) => {
                const isSelected = selectedZohoId === sug.id;
                const simPct = Math.round(Number(sug.similarity) * 100);
                const simTone =
                  simPct >= 85 ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                  : simPct >= 70 ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200';
                return (
                  <button
                    key={sug.id}
                    type="button"
                    onClick={() => setSelectedZohoId(isSelected ? null : sug.id)}
                    className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors ${
                      isSelected ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {isSelected && <Check className="h-3 w-3 shrink-0 text-emerald-600" />}
                      <span className="text-[11px] font-black text-gray-900">{sug.sku}</span>
                      <span className={`ml-auto shrink-0 rounded-full border px-1.5 py-0.5 ${microBadge} ${simTone}`}>
                        {simPct}%
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] font-semibold text-gray-500">{sug.product_title}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Zoho catalog search */}
      <div className="shrink-0 border-b border-gray-100 px-3 py-2.5">
        <p className={`${tableHeader} mb-1.5 text-gray-500`}>Search Zoho Catalog</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={zohoQuery}
            onChange={(e) => { setZohoQuery(e.target.value); setSelectedZohoId(null); }}
            placeholder="Search by SKU or product name..."
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-[11px] font-bold text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          {searchingZoho && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {zohoResults.length === 0 && zohoQuery.trim() && !searchingZoho ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[10px] font-bold text-gray-400">No Zoho products found</p>
          </div>
        ) : (
          zohoResults.map((item) => {
            const isSelected = selectedZohoId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedZohoId(isSelected ? null : item.id)}
                className={`w-full text-left border-b border-gray-50 px-3 py-2.5 transition-colors ${
                  isSelected ? 'bg-emerald-50 border-l-2 border-l-emerald-600' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  <span className="text-[11px] font-black text-gray-900">{item.sku}</span>
                  {item.category && (
                    <span className={`${microBadge} shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-gray-500`}>{item.category}</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[10px] font-semibold text-gray-500">{item.product_title}</p>
              </button>
            );
          })
        )}
      </div>

      {/* Pair button */}
      {selectedZohoId && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="shrink-0 border-t border-gray-200 bg-white px-3 py-3">
          <button
            type="button"
            onClick={handlePair}
            disabled={pairing}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            {pairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Pair to Zoho SKU
          </button>
        </motion.div>
      )}
    </div>
  );
}

// ─── Main Sidebar ───────────────────────────────────────────────────────────

export function SkuCatalogSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;
  const ecwidRowId = searchParams.get('ecwid') ? Number(searchParams.get('ecwid')) : null;
  const mode = searchParams.get('mode') || 'all';
  const sort = searchParams.get('sort') || 'az';
  const sortDir = searchParams.get('dir') || 'asc';
  const urlQ = searchParams.get('q') || '';

  const [localSearch, setLocalSearch] = useState(urlQ);
  const [detail, setDetail] = useState<SkuCatalogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => { setLocalSearch(urlQ); }, [urlQ]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return; }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/sku-catalog/${selectedId}`);
      const data = await res.json();
      if (data.success) setDetail(data);
      else setDetail(null);
    } catch { setDetail(null); }
    setLoadingDetail(false);
  }, [selectedId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) params.delete(key);
      else params.set(key, val);
    }
    router.replace(`/manuals?${params.toString()}`);
  }, [router, searchParams]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    updateParams({ q: value.trim() || null, id: null, ecwid: null });
  };

  const handleModeChange = (id: string) => {
    updateParams({ mode: id === 'all' ? null : id, id: null, ecwid: null });
  };

  const handleSortChange = (id: string) => {
    if (id === sort) {
      updateParams({ dir: sortDir === 'asc' ? 'desc' : null });
    } else {
      updateParams({ sort: id === 'az' ? null : id, dir: null });
    }
  };

  const isPairingMode = mode === 'pairing';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Search */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={localSearch}
          onChange={handleSearchChange}
          onClear={() => handleSearchChange('')}
          placeholder={isPairingMode ? 'Search Ecwid products...' : 'Search SKU catalog...'}
          variant={isPairingMode ? 'orange' : 'blue'}
          size="compact"
        />
      </div>

      {/* Sort slider */}
      <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-1">
        <HorizontalButtonSlider
          items={SORT_ITEMS.map((item) => ({
            ...item,
            label: item.id === sort ? `${item.label} ${sortDir === 'desc' ? '\u2191' : '\u2193'}` : item.label,
          }))}
          value={sort}
          onChange={handleSortChange}
          variant="fba"
          size="md"
          aria-label="Sort order"
        />
      </div>

      {/* Mode slider */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-1.5">
        <HorizontalButtonSlider
          items={MODE_ITEMS}
          value={mode}
          onChange={handleModeChange}
          variant="fba"
          size="md"
          aria-label="Catalog mode"
        />
      </div>

      {/* ── SKU Pairing mode: Ecwid → Zoho pairing flow ── */}
      {isPairingMode && ecwidRowId && (
        <EcwidPairingPanel ecwidRowId={ecwidRowId} updateParams={updateParams} />
      )}

      {isPairingMode && !ecwidRowId && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-[10px] font-bold text-gray-400 text-center">
            Select an Ecwid product from the table to pair
          </p>
        </div>
      )}

      {/* ── Other modes: selected product banner + CRUD sections ── */}
      {!isPairingMode && (
        <>
          {loadingDetail && (
            <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-3 py-4 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          )}

          {detail && !loadingDetail && (
            <SelectedBanner detail={detail} />
          )}

          {!selectedId && !loadingDetail && (
            <div className="shrink-0 border-b border-gray-100 px-3 py-3">
              <p className="text-[10px] font-bold text-gray-400 text-center">
                Select a product from the table to manage
              </p>
            </div>
          )}

          {detail && !loadingDetail && (
            <div className="flex-1 overflow-y-auto">
              <AccordionSection title="Platform Pairings" count={detail.platformIds.length}
                icon={<Link2 className="h-3.5 w-3.5" />} tone="blue" defaultOpen={mode === 'pairing'}>
                <PairingSection catalogId={detail.catalog.id} catalogSku={detail.catalog.sku} platformIds={detail.platformIds} onRefresh={loadDetail} />
              </AccordionSection>

              <AccordionSection title="Manuals" count={detail.manuals.length}
                icon={<FileText className="h-3.5 w-3.5" />} tone="emerald" defaultOpen={mode === 'manuals'}>
                <ManualsSection catalogId={detail.catalog.id} manuals={detail.manuals} onRefresh={loadDetail} />
              </AccordionSection>

              <AccordionSection title="QC Checklist" count={detail.qcChecks.length}
                icon={<Check className="h-3.5 w-3.5" />} tone="amber" defaultOpen={mode === 'qc'}>
                <QcChecklistSection catalogId={detail.catalog.id} qcChecks={detail.qcChecks} onRefresh={loadDetail} />
              </AccordionSection>
            </div>
          )}
        </>
      )}
    </div>
  );
}
