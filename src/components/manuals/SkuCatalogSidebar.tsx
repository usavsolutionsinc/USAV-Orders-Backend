'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Link2, Check, Loader2, ExternalLink } from '@/components/Icons';
import { sidebarHeaderBandClass, sidebarHeaderRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { microBadge, tableHeader } from '@/design-system/tokens/typography/presets';
import { getExternalUrlByPlatform, getPlatformLabelByItemNumber } from '@/hooks/useExternalItemUrl';
import { getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';
import { PairingSection } from '@/components/manuals/sections/PairingSection';
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
    google_file_id: string | null;
    source_url: string | null;
    relative_path: string | null;
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

// ─── Slider items ───────────────────────────────────────────────────────────

// SKU Pairing was retired here — the canonical pairing surface now lives at
// /products?view=pairing (Product Hub with title-trigram suggestions). Library
// is the primary entry, so it sits leftmost.
const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'library', label: 'Library' },
  { id: 'all', label: 'All' },
  { id: 'manuals', label: 'Manuals' },
  { id: 'qc', label: 'QC Checklist' },
];

const SORT_ITEMS: HorizontalSliderItem[] = [
  { id: 'az', label: 'A-Z' },
  { id: 'ordered', label: 'Most Ordered' },
  { id: 'shipped', label: 'Recently Shipped' },
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
        className={`flex w-full items-center gap-2 ${SIDEBAR_GUTTER} py-2.5 text-left hover:bg-gray-50 transition-colors`}>
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
            <div className={`${SIDEBAR_GUTTER} pb-3`}>{children}</div>
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
    <div className={`shrink-0 border-b border-gray-200 bg-blue-50/50 ${SIDEBAR_GUTTER} py-3`}>
      <div className="flex items-start gap-2.5">
        {catalog.image_url && (
          <img src={catalog.image_url} alt="" className="h-9 w-9 rounded-lg object-cover bg-gray-100 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-label font-black tracking-tight text-gray-900">
            {catalog.sku} <span className="text-eyebrow font-bold text-gray-400">— ZOHO</span>
          </p>
          <p className="text-micro font-semibold text-gray-500">{catalog.product_title}</p>
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

// ─── Main Sidebar ───────────────────────────────────────────────────────────

/**
 * Manuals/SKU-catalog sidebar. `basePath` controls which route the
 * mode/sort/search URL writes land on so this sidebar can mount under either
 * `/manuals` (legacy) or `/products` (current home) without forking the file.
 */
export function SkuCatalogSidebar({ basePath = '/manuals' }: { basePath?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;
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
    const qs = params.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath);
  }, [router, searchParams, basePath]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    updateParams({ q: value.trim() || null, id: null, ecwid: null });
  };

  const handleModeChange = (id: string) => {
    // Library lives on a sibling route (/manuals/library) with its own sidebar.
    if (id === 'library') {
      router.replace('/manuals/library');
      return;
    }
    updateParams({ mode: id === 'all' ? null : id, id: null, ecwid: null });
  };

  const handleSortChange = (id: string) => {
    if (id === sort) {
      updateParams({ dir: sortDir === 'asc' ? 'desc' : null });
    } else {
      updateParams({ sort: id === 'az' ? null : id, dir: null });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Search */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={localSearch}
          onChange={handleSearchChange}
          onClear={() => handleSearchChange('')}
          placeholder="Search SKU catalog..."
          variant="blue"
          size="compact"
        />
      </div>

      {/* Sort slider */}
      <div className={`shrink-0 border-b border-gray-100 bg-white ${SIDEBAR_GUTTER} py-1`}>
        <HorizontalButtonSlider
          items={SORT_ITEMS.map((item) => ({
            ...item,
            label: item.id === sort ? `${item.label} ${sortDir === 'desc' ? '\u2191' : '\u2193'}` : item.label,
          }))}
          value={sort}
          onChange={handleSortChange}
          variant="nav"
          size="md"
          aria-label="Sort order"
        />
      </div>

      {/* Mode slider */}
      <div className={`shrink-0 border-b border-gray-200 bg-white ${SIDEBAR_GUTTER} py-1.5`}>
        <HorizontalButtonSlider
          items={MODE_ITEMS}
          value={mode}
          onChange={handleModeChange}
          variant="nav"
          size="md"
          aria-label="Catalog mode"
        />
      </div>

      {/* Selected product banner + CRUD sections.
          (SKU Pairing mode + Manuals accordion were retired here — pairing now
          lives at /products?view=pairing, and the Manuals section moved into
          Library.) */}
      {loadingDetail && (
        <div className={`shrink-0 border-b border-gray-200 bg-gray-50 ${SIDEBAR_GUTTER} py-4 flex items-center justify-center`}>
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        </div>
      )}

      {detail && !loadingDetail && (
        <SelectedBanner detail={detail} />
      )}

      {!selectedId && !loadingDetail && (
        <div className={`shrink-0 border-b border-gray-100 ${SIDEBAR_GUTTER} py-3`}>
          <p className="text-micro font-bold text-gray-400 text-center">
            Select a product from the table to manage
          </p>
        </div>
      )}

      {detail && !loadingDetail && (
        <div className="flex-1 overflow-y-auto">
          <AccordionSection title="Platform Pairings" count={detail.platformIds.length}
            icon={<Link2 className="h-3.5 w-3.5" />} tone="blue" defaultOpen={false}>
            <PairingSection catalogId={detail.catalog.id} catalogSku={detail.catalog.sku} platformIds={detail.platformIds} onRefresh={loadDetail} />
          </AccordionSection>

          <AccordionSection title="QC Checklist" count={detail.qcChecks.length}
            icon={<Check className="h-3.5 w-3.5" />} tone="amber" defaultOpen={mode === 'qc'}>
            <QcChecklistSection catalogId={detail.catalog.id} qcChecks={detail.qcChecks} onRefresh={loadDetail} />
          </AccordionSection>
        </div>
      )}
    </div>
  );
}
