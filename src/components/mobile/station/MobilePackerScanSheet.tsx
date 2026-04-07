'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { Loader2, Package, AlertTriangle } from '@/components/Icons';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { requestCameraPermission } from '@/hooks/useCamera';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { detectStationScanType } from '@/lib/station-scan-routing';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { formatPSTTimestamp } from '@/utils/date';
import { getLast4 } from '@/components/ui/CopyChip';
import type {
  ActivePackingOrder,
  ActiveFbaScan,
  OrderVariant,
} from '@/hooks/station/packingWizardReducer';

// ─── Types ──────────────────────────────────────────────────────────────────

type SheetPhase = 'scanning' | 'looking-up' | 'found' | 'manual' | 'error';

interface LookupResult {
  order: ActivePackingOrder | null;
  fba: ActiveFbaScan | null;
  variant: OrderVariant;
  packerLogId: number | null;
  scanType: string;
  scannedValue: string;
}

export interface MobilePackerScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the fully resolved order after user taps "Yes, Pack It". */
  onConfirmed: (result: LookupResult) => void;
  userId: string;
  userName: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobilePackerScanSheet({
  isOpen,
  onClose,
  onConfirmed,
  userId,
  userName,
}: MobilePackerScanSheetProps) {
  const [phase, setPhase] = useState<SheetPhase>('scanning');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);

  const scanner = useBarcodeScanner({ dedupMs: 2000 });
  const { normalizeTracking } = useLast8TrackingSearch();

  // ── Lookup logic (mirrors useMobilePackingLookup but returns result) ──

  const performLookup = useCallback(async (scanValue: string) => {
    setPhase('looking-up');
    setLookupError(null);
    scanner.pauseScanning();

    try {
      const scanType = detectStationScanType(scanValue);

      // FBA path
      if (scanType === 'FNSKU' || looksLikeFnsku(scanValue)) {
        const res = await fetch('/api/fba/items/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fnsku: scanValue, staff_id: Number(userId), station: 'PACK_STATION' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'FBA scan failed');

        const result: LookupResult = {
          order: null,
          fba: {
            fnsku: data.fnsku,
            productTitle: data.product_title || scanValue,
            shipmentRef: data.shipment_ref || null,
            plannedQty: Number(data.planned_qty ?? data.expected_qty ?? 0),
            combinedPackScannedQty: Number(data.combined_pack_scanned_qty ?? data.actual_qty ?? 0),
            isNew: !!data.is_new || !!data.auto_added_to_plan,
          },
          variant: 'fba',
          packerLogId: data.packerLogId ?? data.packer_log_id ?? null,
          scanType: 'FBA',
          scannedValue: scanValue,
        };
        setLookupResult(result);
        setPhase('found');
        return;
      }

      // Regular packing path
      const isTrackingInput = !scanValue.includes(':') && !/^(clean|fba-)/i.test(scanValue);
      const normalizedScan = isTrackingInput ? normalizeTracking(scanValue) : scanValue;

      const res = await fetch('/api/packing-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: normalizedScan,
          photos: [],
          packerId: String(userId),
          packerName: userName,
          createdAt: formatPSTTimestamp(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save packing scan');

      const resolvedScanType = String(data?.trackingType || '').trim() || 'ORDERS';
      const packerLogId = data.packerRecord?.id ?? null;

      // Broadcast for packer table
      if (packerLogId) {
        window.dispatchEvent(new CustomEvent('packer-log-added', { detail: data.packerRecord }));
      }

      if (resolvedScanType === 'FBA' && data?.fba) {
        const result: LookupResult = {
          order: null,
          fba: {
            fnsku: String(data.fba.fnskus || '').split(',')[0]?.trim() || '',
            productTitle: String(data?.productTitle || '').trim() || 'FBA Shipment',
            shipmentRef: data.fba.shipment_ref || null,
            plannedQty: Number(data.fba.total_qty ?? 0),
            combinedPackScannedQty: Number(data.fba.total_qty ?? 0),
            isNew: false,
          },
          variant: 'fba',
          packerLogId,
          scanType: 'FBA',
          scannedValue: scanValue,
        };
        setLookupResult(result);
        setPhase('found');
      } else if (data?.orderFound === false || data?.isException) {
        const result: LookupResult = {
          order: {
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown — Exception',
            qty: 1,
            condition: 'N/A',
            tracking: String(data?.shippingTrackingNumber || scanValue).trim(),
            sku: data?.sku || '',
            itemNumber: data?.itemNumber || '',
            shipByDate: data?.shipByDate || '',
            createdAt: data?.createdAt || '',
          },
          fba: null,
          variant: 'exception',
          packerLogId,
          scanType: 'ORDERS',
          scannedValue: scanValue,
        };
        setLookupResult(result);
        setPhase('found');
      } else {
        const variant: OrderVariant = /^RS-/i.test(String(data?.orderId || '')) ? 'repair' : 'order';
        const result: LookupResult = {
          order: {
            orderId: String(data?.orderId || '').trim(),
            productTitle: String(data?.productTitle || '').trim() || 'Unknown product',
            qty: Math.max(1, Number(data?.qty ?? data?.quantity ?? data?.orderQty ?? 1) || 1),
            condition: String(data?.condition || '').trim() || 'N/A',
            tracking: String(data?.shippingTrackingNumber || scanValue).trim(),
            sku: String(data?.sku || '').trim(),
            itemNumber: String(data?.itemNumber || '').trim(),
            shipByDate: data?.shipByDate || '',
            createdAt: data?.createdAt || '',
          },
          fba: null,
          variant,
          packerLogId,
          scanType: resolvedScanType,
          scannedValue: scanValue,
        };
        setLookupResult(result);
        setPhase('found');
      }
    } catch (err: any) {
      setLookupError(err?.message || 'Scan failed');
      setPhase('error');
    }
  }, [userId, userName, normalizeTracking, scanner]);

  // ── React to barcode decode ──

  useEffect(() => {
    if (scanner.lastScannedValue && phase === 'scanning') {
      performLookup(scanner.lastScannedValue);
      scanner.resetLastScan();
    }
  }, [scanner.lastScannedValue, phase, performLookup, scanner]);

  // ── Open / close lifecycle ──

  useEffect(() => {
    if (isOpen) {
      setPhase('scanning');
      setLookupResult(null);
      setLookupError(null);
      setManualValue('');
      scanner.resetLastScan();
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Handlers ──

  const handleConfirm = useCallback(() => {
    if (!lookupResult) return;
    scanner.acceptScan();
    onConfirmed(lookupResult);
  }, [lookupResult, scanner, onConfirmed]);

  const handleRescan = useCallback(() => {
    setPhase('scanning');
    setLookupResult(null);
    setLookupError(null);
    scanner.resetLastScan();
    if (scanner.scanStatus === 'idle') {
      void scanner.startScanning();
    } else {
      scanner.resumeScanning();
    }
  }, [scanner]);

  const handleManualSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    setManualValue('');
    performLookup(trimmed);
  }, [manualValue, performLookup]);

  const handleOpenManual = useCallback(() => {
    setPhase('manual');
    scanner.pauseScanning();
    setTimeout(() => manualInputRef.current?.focus(), 200);
  }, [scanner]);

  const handleBackToScan = useCallback(() => {
    setPhase('scanning');
    if (scanner.scanStatus === 'idle') {
      void scanner.startScanning();
    } else {
      scanner.resumeScanning();
    }
  }, [scanner]);

  // ── Derived display values ──

  const displayTitle = lookupResult?.order?.productTitle || lookupResult?.fba?.productTitle || '';
  const displayTracking = lookupResult?.order?.tracking || lookupResult?.scannedValue || '';
  const displayQty = lookupResult?.order?.qty ?? lookupResult?.fba?.plannedQty ?? 1;
  const displayCondition = lookupResult?.order?.condition || '';
  const isException = lookupResult?.variant === 'exception';
  const isFba = lookupResult?.variant === 'fba';

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
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
              Scan to Pack
            </p>
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
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
                phase === 'found' || phase === 'looking-up' ? 'opacity-30' : 'opacity-100'
              }`}
            />

            {/* Camera error */}
            {scanner.scanStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <div className="h-16 w-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                  <svg className="h-8 w-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-white mb-1">Camera unavailable</p>
                <p className="text-xs text-gray-400 mb-4">{scanner.error || 'Enable camera access in settings.'}</p>
                <div className="flex flex-col gap-2 w-full max-w-[200px]">
                  <button type="button" onClick={() => scanner.startScanning()} className="h-11 px-5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:bg-blue-700 transition-colors">
                    Try Again
                  </button>
                  <button type="button" onClick={handleOpenManual} className="h-11 px-5 rounded-xl bg-white/10 text-white text-[11px] font-black uppercase tracking-wider active:bg-white/20 transition-colors">
                    Type Manually
                  </button>
                </div>
              </div>
            )}

            {/* Viewfinder overlay (scanning state) */}
            {(phase === 'scanning') && scanner.scanStatus !== 'error' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[72%] max-w-[300px] aspect-[4/3]">
                  <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                  <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                  <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                  <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
                  <motion.div
                    animate={{ y: ['0%', '100%', '0%'] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
                  />
                </div>
              </div>
            )}

            {/* Looking up overlay */}
            <AnimatePresence>
              {phase === 'looking-up' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center"
                >
                  <Loader2 className="w-10 h-10 text-white animate-spin mb-4" />
                  <p className="text-sm font-black text-white">Looking up order...</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Lookup error overlay */}
            <AnimatePresence>
              {phase === 'error' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center px-6"
                >
                  <div className="h-14 w-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-7 h-7 text-red-400" />
                  </div>
                  <p className="text-sm font-black text-white mb-1">Lookup Failed</p>
                  <p className="text-xs text-gray-400 text-center mb-5">{lookupError}</p>
                  <button
                    type="button"
                    onClick={handleRescan}
                    className="h-11 px-6 rounded-xl bg-white/15 text-white text-[11px] font-black uppercase tracking-wider active:bg-white/25 transition-colors"
                  >
                    Try Again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Found: product confirmation bottom sheet ── */}
            <AnimatePresence>
              {phase === 'found' && lookupResult && (
                <motion.div
                  initial={framerPresenceMobile.confirmation.initial}
                  animate={framerPresenceMobile.confirmation.animate}
                  exit={framerPresenceMobile.confirmation.exit}
                  transition={framerTransitionMobile.confirmationSlideUp}
                  className="absolute inset-x-0 bottom-0 z-10"
                >
                  <div className="bg-white rounded-t-3xl shadow-2xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3">
                      {isException ? (
                        <>
                          <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-wider text-amber-600">No Match Found</p>
                            <p className="text-[10px] text-gray-400">Proceed with exception?</p>
                          </div>
                        </>
                      ) : isFba ? (
                        <>
                          <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center">
                            <Package className="w-4 h-4 text-purple-600" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-wider text-purple-600">FBA Shipment</p>
                            <p className="text-[10px] text-gray-400">Does this look right?</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                            <Package className="w-4 h-4 text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600">Order Found</p>
                            <p className="text-[10px] text-gray-400">Does this look right?</p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Product title */}
                    <h3 className="text-[15px] font-black text-gray-900 leading-tight mb-3">
                      {displayTitle || 'Unknown product'}
                    </h3>

                    {/* Detail chips */}
                    <div className="flex flex-wrap gap-2 mb-5">
                      {displayTracking && (
                        <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[10px] font-mono font-bold text-gray-600">
                          TRK ...{getLast4(displayTracking)}
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[10px] font-black text-gray-600 tabular-nums">
                        Qty {displayQty}
                      </span>
                      {displayCondition && displayCondition !== 'N/A' && (
                        <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[10px] font-bold text-gray-600">
                          {displayCondition}
                        </span>
                      )}
                      {isFba && lookupResult.fba?.shipmentRef && (
                        <span className="inline-flex items-center rounded-lg bg-purple-50 border border-purple-200 px-2.5 py-1.5 text-[10px] font-black text-purple-700">
                          {lookupResult.fba.shipmentRef}
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleConfirm}
                        className={`flex-1 h-[52px] rounded-2xl text-white text-[12px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
                          isException
                            ? 'bg-amber-600 active:bg-amber-700'
                            : isFba
                              ? 'bg-purple-600 active:bg-purple-700'
                              : 'bg-emerald-600 active:bg-emerald-700'
                        }`}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {isException ? 'Proceed Anyway' : 'Yes, Pack It'}
                      </button>
                      <button
                        type="button"
                        onClick={handleRescan}
                        className="h-[52px] px-5 rounded-2xl bg-gray-100 text-gray-700 text-[12px] font-black uppercase tracking-wider active:bg-gray-200 transition-colors"
                      >
                        Rescan
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Scanning: torch + manual entry ── */}
            {phase === 'scanning' && scanner.scanStatus !== 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.2 }}
                className="absolute bottom-4 inset-x-0 px-4"
              >
                {/* Torch toggle */}
                <div className="flex justify-center mb-3">
                  <button
                    type="button"
                    onClick={() => scanner.toggleTorch()}
                    className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${
                      scanner.torchOn ? 'bg-yellow-400/30 text-yellow-300 border border-yellow-400/50' : 'bg-white/10 text-white/60 border border-white/20'
                    }`}
                    aria-label={scanner.torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </button>
                </div>

                {/* Manual entry link */}
                <button
                  type="button"
                  onClick={handleOpenManual}
                  className="w-full text-center text-[10px] font-bold text-white/50 uppercase tracking-wider active:text-white/70 transition-colors"
                >
                  Type manually
                </button>
              </motion.div>
            )}
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
                  &larr; Back to camera
                </button>
              </div>
              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="Enter tracking number..."
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="flex-1 h-12 rounded-xl bg-white/10 border border-white/20 px-4 text-sm font-bold text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/50"
                />
                <button
                  type="submit"
                  disabled={!manualValue.trim()}
                  className="h-12 px-5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-40 active:bg-emerald-700 transition-colors"
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
