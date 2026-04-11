'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { routeScan, type ScanRoute } from '@/lib/barcode-routing';
import { X } from '@/components/Icons';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MobileSkuStockScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with a classified scan result — parent decides where to route. */
  onScanConfirmed: (route: ScanRoute) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Full-screen camera overlay for the SKU Stock mobile flow.
 *
 * Features:
 * - ZXing camera decode (via useBarcodeScanner)
 * - Inline text input fallback (wedge-ready, manual entry)
 * - Torch toggle
 * - Auto-classify scanned/typed value via routeScan() → sku | bin
 * - On successful classification, fires onScanConfirmed() and closes
 */
export function MobileSkuStockScanSheet({
  isOpen,
  onClose,
  onScanConfirmed,
}: MobileSkuStockScanSheetProps) {
  const [manualValue, setManualValue] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);

  const scanner = useBarcodeScanner({ dedupMs: 2000 });

  // ── Finalize a value (from camera OR text input) ──

  const finalize = useCallback(
    (raw: string) => {
      const route = routeScan(raw);
      if (!route) return;
      scanner.acceptScan();
      onScanConfirmed(route);
      setManualValue('');
    },
    [scanner, onScanConfirmed],
  );

  // ── React to new barcode decode from camera ──

  useEffect(() => {
    if (isOpen && scanner.lastScannedValue) {
      finalize(scanner.lastScannedValue);
      scanner.resetLastScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.lastScannedValue, isOpen]);

  // ── Start / stop camera with sheet lifecycle ──

  useEffect(() => {
    if (isOpen) {
      setManualValue('');
      scanner.resetLastScan();
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Manual form submit ──

  const handleManualSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = manualValue.trim();
      if (!trimmed) return;
      finalize(trimmed);
    },
    [manualValue, finalize],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={framerPresenceMobile.camera.initial}
          animate={framerPresenceMobile.camera.animate}
          exit={framerPresenceMobile.camera.exit}
          transition={framerTransitionMobile.cameraEnter}
          className="fixed inset-0 z-[200] flex flex-col bg-black"
        >
          {/* ── Top bar ── */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
                Scan SKU or Bin
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close scanner"
              className="h-11 w-11 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Camera viewfinder ── */}
          <div className="flex-1 relative overflow-hidden">
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover ${
                scanner.scanStatus === 'scanning' || scanner.scanStatus === 'paused'
                  ? 'opacity-100'
                  : 'opacity-0'
              }`}
            />

            {scanner.scanStatus === 'error' ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center h-full">
                <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="h-8 w-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-white mb-1">Camera unavailable</p>
                <p className="text-xs text-gray-400 mb-4 max-w-[260px]">
                  {scanner.error || 'Enable camera access in your browser settings.'}
                </p>
                <button
                  type="button"
                  onClick={() => void scanner.startScanning()}
                  className="h-11 px-5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:bg-blue-700 transition-colors"
                >
                  Try Again
                </button>
              </div>
            ) : scanner.scanStatus === 'idle' ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center h-full">
                <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-white mb-1">Preparing camera</p>
                <p className="text-xs text-gray-400 mb-4">Starting the scanner…</p>
              </div>
            ) : (
              <>
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative w-[72%] max-w-[300px] aspect-square">
                    <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                    <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                    <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                    <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
                    <motion.div
                      animate={{ y: ['0%', '100%', '0%'] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent"
                    />
                  </div>
                </div>

                {/* Torch toggle */}
                <div className="absolute top-4 right-4">
                  <button
                    type="button"
                    onClick={() => scanner.toggleTorch()}
                    className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${
                      scanner.torchOn
                        ? 'bg-yellow-400/30 text-yellow-300 border border-yellow-400/50'
                        : 'bg-white/10 text-white/60 border border-white/20'
                    }`}
                    aria-label={scanner.torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Manual entry (always visible, fallback + wedge support) ── */}
          <div className="flex-shrink-0 bg-black/80 backdrop-blur-sm px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                ref={manualInputRef}
                type="text"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder="Type SKU or bin…"
                autoComplete="off"
                autoCapitalize="characters"
                className="flex-1 h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-sm font-bold text-white placeholder:text-white/40 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/50"
              />
              <button
                type="submit"
                disabled={!manualValue.trim()}
                className="h-12 px-5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-40 active:bg-blue-700 transition-colors"
              >
                Go
              </button>
            </form>
            <p className="mt-2 text-center text-[9px] font-bold text-white/40 uppercase tracking-wider">
              Scan with camera or type to search
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
