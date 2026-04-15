'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { X } from '@/components/Icons';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useMobilePair } from '@/contexts/MobilePairContext';

export interface MobileReceivingScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type PairMode = 'scan' | 'code';

/**
 * Phone-side bottom sheet.
 *
 * Two modes:
 * ─ Unpaired  → user scans the desktop's pair QR (a /m/pair/{code} URL) or
 *   types the 6-char code. Claims the code, stashes session.
 * ─ Paired    → continuous PO-tracking scanner. Every decode publishes
 *   `phone_scan` on the paired phone:{staffId} channel and surfaces the
 *   station-side echo (matched/unmatched) as chips.
 */
export function MobileReceivingScanSheet({
  isOpen,
  onClose,
}: MobileReceivingScanSheetProps) {
  const { session, connState, scans, claimCode, disconnect, publishScan } = useMobilePair();

  const [pairMode, setPairMode] = useState<PairMode>('scan');
  const [manualCode, setManualCode] = useState('');
  const [manualTracking, setManualTracking] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const manualCodeRef = useRef<HTMLInputElement>(null);
  const manualTrackingRef = useRef<HTMLInputElement>(null);

  const paired = Boolean(session);
  const scanner = useBarcodeScanner({ dedupMs: 1500 });

  // Start/stop camera with sheet lifecycle.
  useEffect(() => {
    if (isOpen) {
      setClaimError(null);
      scanner.resetLastScan();
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
      setManualCode('');
      setManualTracking('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleScanForPairing = useCallback(
    async (raw: string) => {
      // Accept either the full pair URL (/m/pair/ABCDEF) or a bare code.
      const trimmed = raw.trim();
      const urlMatch = trimmed.match(/\/m\/pair\/([A-Z0-9]{4,12})/i);
      const code = (urlMatch ? urlMatch[1] : trimmed).toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) {
        setClaimError('That QR is not a pairing code.');
        return;
      }
      setClaiming(true);
      setClaimError(null);
      scanner.acceptScan();
      const result = await claimCode(code);
      setClaiming(false);
      if (!result.ok) {
        setClaimError(result.error);
        // Let user scan again.
        scanner.resetLastScan();
      }
    },
    [claimCode, scanner],
  );

  const handleScanForReceiving = useCallback(
    (raw: string) => {
      publishScan(raw);
      scanner.acceptScan();
      // Re-arm after a short beat so rapid scans still work.
      window.setTimeout(() => scanner.resetLastScan(), 800);
    },
    [publishScan, scanner],
  );

  // React to decodes — which flow depends on pair state.
  useEffect(() => {
    if (!scanner.lastScannedValue) return;
    if (paired) handleScanForReceiving(scanner.lastScannedValue);
    else void handleScanForPairing(scanner.lastScannedValue);
  }, [scanner.lastScannedValue, paired, handleScanForPairing, handleScanForReceiving]);

  const handleManualPairSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!manualCode.trim()) return;
      setClaiming(true);
      setClaimError(null);
      const result = await claimCode(manualCode);
      setClaiming(false);
      if (result.ok) setManualCode('');
      else setClaimError(result.error);
    },
    [manualCode, claimCode],
  );

  const handleManualTrackingSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const t = manualTracking.trim();
      if (!t) return;
      publishScan(t);
      setManualTracking('');
      manualTrackingRef.current?.focus();
    },
    [manualTracking, publishScan],
  );

  const cameraReady =
    scanner.scanStatus === 'scanning' || scanner.scanStatus === 'paused';

  const headerLabel = paired
    ? 'Scan PO tracking'
    : pairMode === 'scan'
      ? 'Scan pairing QR'
      : 'Enter pairing code';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={framerPresenceMobile.camera.initial}
          animate={framerPresenceMobile.camera.animate}
          exit={framerPresenceMobile.camera.exit}
          transition={framerTransitionMobile.cameraEnter}
          className="fixed inset-0 z-[200] flex flex-col bg-white"
          role="dialog"
          aria-modal="true"
          aria-label={headerLabel}
        >
          {/* Top bar */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 bg-white border-b border-gray-200">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
                {headerLabel}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    paired && connState === 'connected'
                      ? 'bg-emerald-500'
                      : paired
                        ? 'bg-amber-500'
                        : 'bg-gray-400'
                  }`}
                />
                <p className="text-[10px] font-bold text-gray-700">
                  {paired
                    ? session?.staff_name
                      ? `Paired · ${session.staff_name}`
                      : `Paired · Staff #${session?.staff_id}`
                    : 'Not paired'}
                </p>
                {paired && (
                  <button
                    type="button"
                    onClick={disconnect}
                    className="ml-2 text-[9px] font-black uppercase tracking-wider text-gray-400 hover:text-gray-700"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="h-11 w-11 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 active:bg-gray-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body — camera viewport stays dark (it's a video feed) */}
          <div className="flex-1 relative overflow-hidden bg-gray-900">
            {/* Camera */}
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover ${
                cameraReady && (paired || pairMode === 'scan') ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Camera error */}
            {scanner.scanStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center bg-white">
                <p className="text-sm font-bold text-gray-900 mb-1">Camera unavailable</p>
                <p className="text-xs text-gray-500 mb-4 max-w-[260px]">
                  {scanner.error || 'Enable camera access in your browser settings.'}
                </p>
                <button
                  type="button"
                  onClick={() => void scanner.startScanning()}
                  className="h-11 px-5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:bg-blue-700"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Viewfinder overlay when camera active in a camera mode */}
            {cameraReady && (paired || pairMode === 'scan') && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[72%] max-w-[300px] aspect-square">
                  <span className="absolute top-0 left-0 h-6 w-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                  <span className="absolute top-0 right-0 h-6 w-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                  <span className="absolute bottom-0 left-0 h-6 w-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                  <span className="absolute bottom-0 right-0 h-6 w-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
                  <motion.div
                    animate={{ y: ['0%', '100%', '0%'] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    className={`absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent to-transparent ${
                      paired ? 'via-emerald-400' : 'via-blue-400'
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Torch */}
            {cameraReady && (paired || pairMode === 'scan') && (
              <div className="absolute top-4 right-4">
                <button
                  type="button"
                  onClick={() => scanner.toggleTorch()}
                  className={`h-10 w-10 rounded-full flex items-center justify-center ${
                    scanner.torchOn
                      ? 'bg-yellow-400/30 text-yellow-200 border border-yellow-400/50'
                      : 'bg-white/15 text-white/80 border border-white/25'
                  }`}
                  aria-label={scanner.torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </button>
              </div>
            )}

            {/* Claim-in-flight overlay */}
            {claiming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm">
                <div className="h-10 w-10 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin mb-3" />
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-800">
                  Pairing…
                </p>
              </div>
            )}

            {/* Unpaired + code-entry mode — hide camera, show big input */}
            {!paired && pairMode === 'code' && (
              <div className="absolute inset-0 bg-white flex flex-col items-center justify-center px-6">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">
                  Type the 6-char code
                </p>
                <form
                  onSubmit={handleManualPairSubmit}
                  className="w-full max-w-[280px] flex flex-col gap-3"
                >
                  <input
                    ref={manualCodeRef}
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="h-14 rounded-xl bg-gray-50 border border-gray-300 px-4 text-center text-[22px] font-mono font-black tracking-[0.4em] text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
                  />
                  <button
                    type="submit"
                    disabled={!manualCode.trim()}
                    className="h-12 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-40 active:bg-blue-700"
                  >
                    Pair
                  </button>
                </form>
              </div>
            )}

            {/* Scan echo list (paired) */}
            {paired && scans.length > 0 && (
              <div className="absolute top-20 left-4 right-4 max-h-[30%] overflow-y-auto space-y-1.5">
                {scans.slice(0, 4).map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border px-3 py-2 text-[11px] backdrop-blur-sm ${
                      s.status === 'matched'
                        ? 'bg-emerald-50/90 border-emerald-300 text-emerald-800'
                        : s.status === 'unmatched'
                          ? 'bg-amber-50/90 border-amber-300 text-amber-800'
                          : s.status === 'error'
                            ? 'bg-red-50/90 border-red-300 text-red-800'
                            : 'bg-white/90 border-gray-200 text-gray-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-black truncate">{s.tracking}</span>
                      <span className="text-[9px] font-black uppercase tracking-widest opacity-80">
                        {s.status === 'unmatched' && s.exception_id
                          ? `queued · #${s.exception_id}`
                          : s.status}
                      </span>
                    </div>
                    {s.po_ids.length > 0 && (
                      <p className="text-[10px] mt-0.5 opacity-80">
                        PO: <span className="font-mono">{s.po_ids.join(', ')}</span>
                      </p>
                    )}
                    {s.status === 'unmatched' && s.exception_reason && (
                      <p className="text-[10px] mt-0.5 opacity-70">
                        {s.exception_reason === 'zoho_unreachable'
                          ? 'Zoho unreachable — will retry'
                          : 'No PO yet — logged for review'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom area: mode toggle (unpaired) OR manual tracking input (paired) */}
          <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-3">
            {claimError && (
              <p className="text-[11px] font-bold text-red-600 text-center">{claimError}</p>
            )}

            {!paired ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPairMode('scan')}
                  className={`flex-1 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                    pairMode === 'scan'
                      ? 'bg-gray-900 text-white border border-gray-900'
                      : 'bg-white text-gray-600 border border-gray-300'
                  }`}
                >
                  Scan QR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPairMode('code');
                    setTimeout(() => manualCodeRef.current?.focus(), 120);
                  }}
                  className={`flex-1 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${
                    pairMode === 'code'
                      ? 'bg-gray-900 text-white border border-gray-900'
                      : 'bg-white text-gray-600 border border-gray-300'
                  }`}
                >
                  Enter code
                </button>
              </div>
            ) : (
              <form onSubmit={handleManualTrackingSubmit} className="flex gap-2">
                <input
                  ref={manualTrackingRef}
                  type="text"
                  value={manualTracking}
                  onChange={(e) => setManualTracking(e.target.value)}
                  placeholder="Type tracking…"
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="flex-1 h-12 rounded-xl bg-gray-50 border border-gray-300 px-4 text-sm font-bold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40"
                />
                <button
                  type="submit"
                  disabled={!manualTracking.trim()}
                  className="h-12 px-5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wider disabled:opacity-40 active:bg-emerald-700"
                >
                  Send
                </button>
              </form>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
