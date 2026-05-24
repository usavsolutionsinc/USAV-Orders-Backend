'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { X } from '@/components/Icons';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';

export interface MobileReceivingScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type ScanStatus = 'pending' | 'matched' | 'unmatched' | 'error';

type PhoneScan = {
  id: string;
  tracking: string;
  status: ScanStatus;
  po_ids: string[];
  exception_id?: number | null;
  exception_reason?: string | null;
  error?: string | null;
  at: number;
};

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Phone-side scan sheet. Requires the user to be signed in (the FAB hides
 * itself when there's no session). Each decoded tracking number is published
 * on `phone:{staffId}`; the desktop bridge or /receiving sidebar performs the
 * lookup and echoes the result on `station:{staffId}` for the chips below.
 */
export function MobileReceivingScanSheet({
  isOpen,
  onClose,
}: MobileReceivingScanSheetProps) {
  const { user } = useAuth();
  const { getClient } = useAblyClient();
  const staffId = user?.staffId ?? 0;
  const staffName = (user as { name?: string } | null)?.name ?? null;

  const [scans, setScans] = useState<PhoneScan[]>([]);
  const [manualTracking, setManualTracking] = useState('');
  const manualTrackingRef = useRef<HTMLInputElement>(null);

  const scanner = useBarcodeScanner({ dedupMs: 1500 });

  const phoneChannel = staffId > 0 ? `phone:${staffId}` : 'phone:__idle__';
  const stationChannel = staffId > 0 ? `station:${staffId}` : 'station:__idle__';

  // Start/stop camera with sheet lifecycle.
  useEffect(() => {
    if (isOpen) {
      scanner.resetLastScan();
      void scanner.startScanning();
    } else {
      void scanner.stopScanning();
      setManualTracking('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const publishScan = useCallback(
    async (raw: string) => {
      const tracking = raw.trim();
      if (!tracking || staffId <= 0) return;

      const id = randomId();
      const fresh: PhoneScan = {
        id,
        tracking,
        status: 'pending',
        po_ids: [],
        at: Date.now(),
      };
      setScans((prev) => [fresh, ...prev].slice(0, 8));

      try {
        const client = await getClient();
        if (!client) {
          setScans((prev) =>
            prev.map((s) =>
              s.id === id ? { ...s, status: 'error', error: 'Realtime unavailable' } : s,
            ),
          );
          return;
        }
        const ch = client.channels.get(phoneChannel);
        await ch.publish('phone_scan', { tracking, at: Date.now() });
      } catch (err) {
        setScans((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Publish failed',
                }
              : s,
          ),
        );
      }
    },
    [getClient, phoneChannel, staffId],
  );

  const handleScanForReceiving = useCallback(
    (raw: string) => {
      void publishScan(raw);
      scanner.acceptScan();
      window.setTimeout(() => scanner.resetLastScan(), 800);
    },
    [publishScan, scanner],
  );

  // React to decodes.
  useEffect(() => {
    if (!scanner.lastScannedValue) return;
    handleScanForReceiving(scanner.lastScannedValue);
  }, [scanner.lastScannedValue, handleScanForReceiving]);

  // Subscribe to the desktop's echo so chips can resolve.
  useAblyChannel(
    stationChannel,
    'phone_scan_result',
    (msg: {
      data?: {
        tracking?: string;
        matched?: boolean;
        po_ids?: string[];
        exception_id?: number | null;
        exception_reason?: string | null;
        error?: string | null;
      };
    }) => {
      const data = msg?.data;
      const tracking = String(data?.tracking || '').trim();
      if (!tracking) return;
      setScans((prev) =>
        prev.map((s) => {
          if (s.tracking !== tracking || s.status === 'matched' || s.status === 'unmatched') {
            return s;
          }
          if (data?.error) {
            return { ...s, status: 'error', error: data.error ?? null };
          }
          return {
            ...s,
            status: data?.matched ? 'matched' : 'unmatched',
            po_ids: Array.isArray(data?.po_ids) ? data.po_ids : [],
            exception_id:
              typeof data?.exception_id === 'number' ? data.exception_id : null,
            exception_reason: data?.exception_reason ?? null,
          };
        }),
      );
    },
    staffId > 0,
  );

  const handleManualTrackingSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const t = manualTracking.trim();
      if (!t) return;
      void publishScan(t);
      setManualTracking('');
      manualTrackingRef.current?.focus();
    },
    [manualTracking, publishScan],
  );

  const cameraReady =
    scanner.scanStatus === 'scanning' || scanner.scanStatus === 'paused';

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
          aria-label="Scan PO tracking"
        >
          {/* Top bar */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 bg-white border-b border-gray-200">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">
                Scan PO tracking
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <p className="text-xs font-bold text-gray-700">
                  {staffName ? `Signed in · ${staffName}` : `Staff #${staffId}`}
                </p>
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
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none absolute inset-0 w-full h-full object-cover ${
                cameraReady ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {scanner.scanStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center bg-white">
                <p className="text-sm font-bold text-gray-900 mb-1">Camera unavailable</p>
                <p className="text-xs text-gray-500 mb-4 max-w-[260px]">
                  {scanner.error || 'Enable camera access in your browser settings.'}
                </p>
                <button
                  type="button"
                  onClick={() => void scanner.startScanning()}
                  className="h-11 px-5 rounded-xl bg-blue-600 text-white text-caption font-black uppercase tracking-wider active:bg-blue-700"
                >
                  Try Again
                </button>
              </div>
            )}

            {cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[72%] max-w-[300px] aspect-square">
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

            {cameraReady && (
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

            {/* Scan echo list */}
            {scans.length > 0 && (
              <div className="absolute top-20 left-4 right-4 max-h-[30%] overflow-y-auto space-y-1.5">
                {scans.slice(0, 4).map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border px-3 py-2 text-caption backdrop-blur-sm ${
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
                      <span className="text-xs font-black uppercase tracking-widest opacity-80">
                        {s.status === 'unmatched' && s.exception_id
                          ? `queued · #${s.exception_id}`
                          : s.status}
                      </span>
                    </div>
                    {s.po_ids.length > 0 && (
                      <p className="text-xs mt-0.5 opacity-80">
                        PO: <span className="font-mono">{s.po_ids.join(', ')}</span>
                      </p>
                    )}
                    {s.status === 'unmatched' && s.exception_reason && (
                      <p className="text-xs mt-0.5 opacity-70">
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

          {/* Bottom: manual tracking input */}
          <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
                className="h-12 px-5 rounded-xl bg-emerald-600 text-white text-caption font-black uppercase tracking-wider disabled:opacity-40 active:bg-emerald-700"
              >
                Send
              </button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
