'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { SKU_STOCK_DESKTOP_SCAN_EVENT } from '@/utils/events';

/**
 * Desktop-only full-screen SKU camera scanner invoked from Quick tools FAB.
 * Open from any route; merges `sku=` into `/sku-stock` URLs when already there.
 */
export function GlobalDesktopSkuScanner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [showScanner, setShowScanner] = useState(false);

  const {
    videoRef,
    lastScannedValue,
    startScanning,
    stopScanning,
    acceptScan,
  } = useBarcodeScanner({ dedupMs: 3000 });

  const goToSku = useCallback(
    (raw: string) => {
      const s = raw.trim();
      if (!s) return;
      if (pathname === '/sku-stock' || pathname?.startsWith('/sku-stock/')) {
        const next = new URLSearchParams(searchParams.toString());
        next.set('sku', s);
        router.replace(`/sku-stock?${next.toString()}`);
      } else {
        router.push(`/sku-stock?sku=${encodeURIComponent(s)}`);
      }
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (!lastScannedValue) return;
    acceptScan();
    stopScanning();
    setShowScanner(false);
    goToSku(lastScannedValue);
  }, [lastScannedValue, acceptScan, stopScanning, goToSku]);

  const handleOpenScanner = useCallback(async () => {
    setShowScanner(true);
    await startScanning();
  }, [startScanning]);

  const handleCloseScanner = useCallback(async () => {
    setShowScanner(false);
    await stopScanning();
  }, [stopScanning]);

  useEffect(() => {
    const onOpen = () => {
      void handleOpenScanner();
    };
    window.addEventListener(SKU_STOCK_DESKTOP_SCAN_EVENT, onOpen);
    return () => window.removeEventListener(SKU_STOCK_DESKTOP_SCAN_EVENT, onOpen);
  }, [handleOpenScanner]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showScanner) void handleCloseScanner();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showScanner, handleCloseScanner]);

  if (!showScanner) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Scan SKU Barcode</p>
        <button
          type="button"
          onClick={() => void handleCloseScanner()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20"
          aria-label="Close scanner"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef as React.Ref<HTMLVideoElement>}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative aspect-square w-[72%] max-w-[300px] rounded-3xl border-[3px] border-white/40 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
            <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-xl border-l-[3px] border-t-[3px] border-white" />
            <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-xl border-r-[3px] border-t-[3px] border-white" />
            <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-xl border-b-[3px] border-l-[3px] border-white" />
            <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-xl border-b-[3px] border-r-[3px] border-white" />
          </div>
        </div>
      </div>
      <div className="flex-shrink-0 bg-black/80 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.target as HTMLFormElement).elements.namedItem('manualSku') as HTMLInputElement;
            const val = input?.value?.trim();
            if (val) {
              void handleCloseScanner();
              goToSku(val);
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
            className="h-11 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white placeholder:text-white/40 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
          />
          <button
            type="submit"
            className="h-11 rounded-xl bg-blue-600 px-4 text-[11px] font-black uppercase tracking-wider text-white active:bg-blue-700"
          >
            Go
          </button>
        </form>
      </div>
    </div>
  );
}
