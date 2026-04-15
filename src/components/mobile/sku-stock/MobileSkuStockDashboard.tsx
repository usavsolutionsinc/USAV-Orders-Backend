'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MobileSkuStockTopBanner,
  type MobileSkuStockMode,
} from './MobileSkuStockTopBanner';
import { MobileSkuStockScanSheet } from './MobileSkuStockScanSheet';
import { RecentScansList } from './RecentScansList';
import {
  BinContentsView,
  type BinContentRow,
  type BinLocation,
} from './BinContentsView';
import { QtyEditBottomSheet } from './QtyEditBottomSheet';
import SkuBrowser from '@/components/sku/SkuBrowser';
import SkuDetailView from '@/components/sku/SkuDetailView';
import { BinLabelPrinter } from '@/components/barcode/BinLabelPrinter';
import { useRecentScans, type RecentScanEntry } from '@/hooks/useRecentScans';
import type { ScanRoute } from '@/lib/barcode-routing';
import { Camera } from '@/components/Icons';

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_MODES: readonly MobileSkuStockMode[] = [
  'scan',
  'stock',
  'history',
  'browse',
  'bin_map',
];

function parseMode(raw: string | null): MobileSkuStockMode {
  if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
    return raw as MobileSkuStockMode;
  }
  return 'scan';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileSkuStockDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = parseMode(searchParams.get('mode'));
  const openSku = searchParams.get('sku');
  const openBin = searchParams.get('bin');

  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  const [qtyEdit, setQtyEdit] = useState<{
    row: BinContentRow;
    location: BinLocation;
  } | null>(null);
  const [binRefreshKey, setBinRefreshKey] = useState(0);

  const { recentScans, addScan, removeScan, clearScans } = useRecentScans();

  // Global mobile FAB delegates to the sku-stock scan sheet on /sku-stock.
  useEffect(() => {
    const h = () => setScanSheetOpen(true);
    window.addEventListener('mobile-scan-fab-open', h);
    return () => window.removeEventListener('mobile-scan-fab-open', h);
  }, []);

  // ── URL manipulation helpers ──

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      updater(next);
      const qs = next.toString();
      router.replace(qs ? `/sku-stock?${qs}` : '/sku-stock');
    },
    [router, searchParams],
  );

  const setMode = useCallback(
    (next: MobileSkuStockMode) => {
      updateParams((p) => {
        if (next === 'scan') p.delete('mode');
        else p.set('mode', next);
        // Clear any open detail/bin overlays when switching modes
        p.delete('sku');
        p.delete('bin');
      });
    },
    [updateParams],
  );

  const openSkuPanel = useCallback(
    (sku: string) => {
      updateParams((p) => p.set('sku', sku));
    },
    [updateParams],
  );

  const closeSkuPanel = useCallback(() => {
    updateParams((p) => p.delete('sku'));
  }, [updateParams]);

  const openBinView = useCallback(
    (barcode: string) => {
      updateParams((p) => {
        p.set('bin', barcode);
        p.delete('sku'); // bin replaces any open sku panel
      });
    },
    [updateParams],
  );

  const closeBinView = useCallback(() => {
    updateParams((p) => {
      p.delete('bin');
      p.delete('sku');
    });
  }, [updateParams]);

  // ── Scan routing ──

  const handleScanConfirmed = useCallback(
    (route: ScanRoute) => {
      setScanSheetOpen(false);
      if (route.type === 'bin') {
        addScan({ value: route.value, type: 'bin' });
        openBinView(route.value);
      } else {
        addScan({ value: route.value, type: 'sku' });
        openSkuPanel(route.value);
      }
    },
    [addScan, openBinView, openSkuPanel],
  );

  const handleRecentSelect = useCallback(
    (entry: RecentScanEntry) => {
      if (entry.type === 'bin') openBinView(entry.value);
      else openSkuPanel(entry.value);
    },
    [openBinView, openSkuPanel],
  );

  // ── Qty edit bottom sheet ──

  const handleEditQty = useCallback(
    (row: BinContentRow, location: BinLocation) => {
      setQtyEdit({ row, location });
    },
    [],
  );

  const handleQtyUpdated = useCallback(() => {
    setBinRefreshKey((k) => k + 1);
  }, []);

  // ── Recent scans: hydrate labels when a bin loads ──

  const handleBinLoaded = useCallback(
    (location: BinLocation, contents: BinContentRow[]) => {
      if (!location.barcode) return;
      const label = location.room
        ? `${location.room} · ${
            location.rowLabel && location.colLabel
              ? `${location.rowLabel}${location.colLabel}`
              : location.name
          }`
        : location.name;
      const subLabel = `${contents.length} SKU${contents.length !== 1 ? 's' : ''} · ${location.barcode}`;
      addScan({ value: location.barcode, type: 'bin', label, subLabel });
    },
    [addScan],
  );

  // ── App nav drawer ──

  const handleOpenAppNav = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-mobile-drawer'));
  }, []);

  // ── Body content per mode ──

  const bodyContent = useMemo(() => {
    if (mode === 'scan') {
      return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
          <RecentScansList
            entries={recentScans}
            onSelect={handleRecentSelect}
            onRemove={(entry) => removeScan(entry.value, entry.type)}
            onClear={recentScans.length > 0 ? clearScans : undefined}
          />
        </div>
      );
    }

    if (mode === 'stock' || mode === 'history' || mode === 'browse') {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
          <SkuBrowser />
        </div>
      );
    }

    if (mode === 'bin_map') {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          <BinLabelPrinter isActive={true} />
        </div>
      );
    }

    return null;
  }, [mode, recentScans, handleRecentSelect, removeScan, clearScans]);

  // ── Sync view query param for SkuBrowser (stock/history) ──

  useEffect(() => {
    if (mode === 'stock' || mode === 'history') {
      const desired = mode === 'history' ? 'sku_history' : 'sku_stock';
      if (searchParams.get('view') !== desired) {
        const next = new URLSearchParams(searchParams.toString());
        next.set('view', desired);
        router.replace(`/sku-stock?${next.toString()}`);
      }
    }
  }, [mode, searchParams, router]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white">
      <MobileSkuStockTopBanner
        mode={mode}
        onModeChange={setMode}
        onOpenAppNav={handleOpenAppNav}
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {bodyContent}

        {/* Bin contents view — slides over whatever body is showing */}
        <AnimatePresence>
          {openBin && (
            <motion.div
              key={`bin-${openBin}`}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="absolute inset-0 z-[90] bg-white"
            >
              <BinContentsView
                barcode={openBin}
                onBack={closeBinView}
                onOpenSku={openSkuPanel}
                onEditQty={handleEditQty}
                onLoaded={handleBinLoaded}
                refreshKey={binRefreshKey}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* FAB scanner button — only on scan landing */}
        {mode === 'scan' && !openBin && !openSku && (
          <button
            type="button"
            onClick={() => setScanSheetOpen(true)}
            aria-label="Open camera scanner"
            className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-[95] flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.4)] transition-transform active:scale-95 active:bg-blue-700"
          >
            <Camera className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* SkuDetailView panel — stacks over everything */}
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

      {/* Qty edit bottom sheet */}
      <QtyEditBottomSheet
        isOpen={qtyEdit !== null}
        row={qtyEdit?.row ?? null}
        location={qtyEdit?.location ?? null}
        onClose={() => setQtyEdit(null)}
        onUpdated={handleQtyUpdated}
      />

      {/* Camera scan sheet */}
      <MobileSkuStockScanSheet
        isOpen={scanSheetOpen}
        onClose={() => setScanSheetOpen(false)}
        onScanConfirmed={handleScanConfirmed}
      />
    </div>
  );
}
