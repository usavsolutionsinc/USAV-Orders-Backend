'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { framerPresenceMobile, framerTransitionMobile } from '../../foundations/motion-framer';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { MobileScanConfirmation } from '@/components/mobile/station/MobileScanConfirmation';
import { detectStationScanType, type StationScanType, type StationInputMode } from '@/lib/station-scan-routing';
import { classifyInput, type ScanCarrier } from '@/lib/scan-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onScanConfirmed: (value: string, type: StationScanType) => void;
  /** Current manual mode override from parent. */
  manualMode: StationInputMode | null;
  onModeChange: (mode: StationInputMode | null) => void;
  /** Active order context — needed for context-aware serial promotion. */
  activeOrderContext?: {
    serialNumbers: string[];
    quantity: number;
  } | null;
  header?: ReactNode;
}

type ScanSheetPhase = 'scanning' | 'confirming' | 'manual';

// ─── Mode pill config ───────────────────────────────────────────────────────

const MODE_PILLS: {
  mode: StationInputMode | null;
  label: string;
  activeClass: string;
}[] = [
  { mode: null, label: 'Auto', activeClass: 'bg-white/25 text-white border-white/40' },
  { mode: 'tracking', label: 'Track', activeClass: 'bg-blue-500/30 text-white border-blue-400/50' },
  { mode: 'serial', label: 'Serial', activeClass: 'bg-emerald-500/30 text-white border-emerald-400/50' },
  { mode: 'fba', label: 'FBA', activeClass: 'bg-violet-500/30 text-white border-violet-400/50' },
  { mode: 'repair', label: 'Repair', activeClass: 'bg-amber-500/30 text-white border-amber-400/50' },
];

function modeToForcedType(mode: StationInputMode | null): StationScanType | null {
  if (mode === 'tracking') return 'TRACKING';
  if (mode === 'serial') return 'SERIAL';
  if (mode === 'fba') return 'FNSKU';
  if (mode === 'repair') return 'REPAIR';
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileScanSheet — fullscreen camera overlay with live barcode decoding,
 * mode pills, and scan confirmation.
 *
 * State machine:
 *   scanning  → decode → confirming
 *   confirming → Confirm → onScanConfirmed → closes
 *   confirming → Rescan  → scanning
 *   scanning  → "Type manually" → manual → submit → confirming
 */
export function MobileScanSheet({
  isOpen,
  onClose,
  onScanConfirmed,
  manualMode,
  onModeChange,
  activeOrderContext,
  header,
}: MobileScanSheetProps) {
  const [phase, setPhase] = useState<ScanSheetPhase>('scanning');
  const [confirmedValue, setConfirmedValue] = useState('');
  const [confirmedType, setConfirmedType] = useState<StationScanType>('TRACKING');
  const [confirmedCarrier, setConfirmedCarrier] = useState<ScanCarrier | null>(null);
  const [manualValue, setManualValue] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);

  const scanner = useBarcodeScanner({ fps: 10 });

  // ── Classify a scanned/typed value ──

  const classifyAndConfirm = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Determine type: forced mode or auto
      const forcedType = modeToForcedType(manualMode);
      let type: StationScanType;
      let carrier: ScanCarrier | null = null;

      if (forcedType) {
        type = forcedType;
      } else {
        type = detectStationScanType(trimmed);
        const classified = classifyInput(trimmed);
        carrier = classified.carrier;

        // Context-aware serial promotion (mirrors resolveScanType in controller)
        if (type === 'TRACKING' && activeOrderContext) {
          const incomplete =
            activeOrderContext.serialNumbers.length < activeOrderContext.quantity;
          if (incomplete) {
            type = 'SERIAL';
          }
        }
      }

      setConfirmedValue(trimmed);
      setConfirmedType(type);
      setConfirmedCarrier(carrier);
      setPhase('confirming');
      scanner.pauseScanning();
    },
    [manualMode, activeOrderContext, scanner],
  );

  // ── React to new barcode decode ──

  useEffect(() => {
    if (scanner.lastScannedValue && phase === 'scanning') {
      classifyAndConfirm(scanner.lastScannedValue);
    }
  }, [scanner.lastScannedValue, phase, classifyAndConfirm]);

  // ── Open / close lifecycle ──

  useEffect(() => {
    if (isOpen) {
      setPhase('scanning');
      setManualValue('');
      scanner.resetLastScan();
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Handlers ──

  const handleConfirm = useCallback(
    (value: string, type: StationScanType) => {
      scanner.acceptScan();
      onScanConfirmed(value, type);
    },
    [scanner, onScanConfirmed],
  );

  const handleRescan = useCallback(() => {
    setPhase('scanning');
    scanner.resetLastScan();
    if (scanner.scanStatus === 'idle') {
      void scanner.startScanning();
      return;
    }
    scanner.resumeScanning();
  }, [scanner]);

  const handleManualSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = manualValue.trim();
      if (!trimmed) return;
      classifyAndConfirm(trimmed);
      setManualValue('');
    },
    [manualValue, classifyAndConfirm],
  );

  const handleOpenManual = useCallback(() => {
    setPhase('manual');
    scanner.pauseScanning();
    setTimeout(() => manualInputRef.current?.focus(), 200);
  }, [scanner]);

  const handleBackToScan = useCallback(() => {
    setPhase('scanning');
    if (scanner.scanStatus === 'idle') {
      void scanner.startScanning();
      return;
    }
    scanner.resumeScanning();
  }, [scanner]);

  const handleStartCamera = useCallback(() => {
    void scanner.startScanning();
  }, [scanner]);

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
              {header ?? (
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
                  Scan Barcode
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close scanner"
              className="h-11 w-11 flex items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── Camera viewfinder ── */}
          <div className="flex-1 relative overflow-hidden">
            {/* Keep the scanner mount point in the DOM even before startScanning()
               so Safari tap-start has a live container ref to attach to. */}
            <div
              ref={scanner.containerRef as React.RefObject<HTMLDivElement>}
              className={`pointer-events-none absolute inset-0 w-full h-full [&_video]:pointer-events-none [&_video]:object-cover [&_video]:w-full [&_video]:h-full ${
                scanner.scanStatus === 'scanning' || scanner.scanStatus === 'paused' ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {scanner.scanStatus === 'error' ? (
              // Camera failed — show error + retry button + manual fallback
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="h-8 w-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-white mb-1">Camera unavailable</p>
                <p className="text-xs text-gray-400 mb-4">
                  {scanner.error || 'Enable camera access in your browser settings.'}
                </p>
                <div className="flex flex-col gap-2 w-full max-w-[200px]">
                  <button
                    type="button"
                    onClick={handleStartCamera}
                    className="h-11 px-5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:bg-blue-700 transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenManual}
                    className="h-11 px-5 rounded-xl bg-white/10 text-white text-[11px] font-black uppercase tracking-wider active:bg-white/20 transition-colors"
                  >
                    Type Manually
                  </button>
                </div>
              </div>
            ) : scanner.scanStatus === 'idle' ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-white mb-1">Preparing camera</p>
                <p className="text-xs text-gray-400 mb-4">Starting the scanner...</p>
              </div>
            ) : (
              <>
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  {/* Corner markers */}
                  <div className="relative w-[72%] max-w-[300px] aspect-square">
                    <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                    <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                    <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                    <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />

                    {/* Animated scan line */}
                    {phase === 'scanning' && (
                      <motion.div
                        animate={{ y: ['0%', '100%', '0%'] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                        className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent"
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── Mode pills (above bottom area) ── */}
            {phase === 'scanning' && scanner.scanStatus !== 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.2 }}
                className="absolute bottom-4 inset-x-0 px-4"
              >
                <div className="flex items-center justify-center gap-2 overflow-x-auto no-scrollbar">
                  {MODE_PILLS.map(({ mode, label, activeClass }) => {
                    const isActive = manualMode === mode;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => onModeChange(mode)}
                        className={`rounded-full border px-3.5 min-h-[44px] text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 whitespace-nowrap ${
                          isActive ? activeClass : 'bg-white/10 text-white/60 border-white/20'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Manual entry link */}
                <button
                  type="button"
                  onClick={handleOpenManual}
                  className="mt-3 w-full text-center text-[10px] font-bold text-white/50 uppercase tracking-wider active:text-white/70 transition-colors"
                >
                  Type manually
                </button>
              </motion.div>
            )}

            {/* ── Confirmation overlay ── */}
            <AnimatePresence>
              {phase === 'confirming' && (
                <>
                  {/* Dim backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60"
                  />
                  <MobileScanConfirmation
                    scannedValue={confirmedValue}
                    detectedType={confirmedType}
                    carrier={confirmedCarrier}
                    onConfirm={handleConfirm}
                    onRescan={handleRescan}
                  />
                </>
              )}
            </AnimatePresence>
          </div>

          {/* ── Manual entry mode ── */}
          {phase === 'manual' && (
            <div className="flex-shrink-0 bg-black/80 backdrop-blur-sm px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={handleBackToScan}
                  className="text-[10px] font-bold text-white/60 uppercase tracking-wider active:text-white/80 transition-colors"
                >
                  ← Back to camera
                </button>
              </div>
              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="Enter code manually..."
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
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
