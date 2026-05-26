'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from '@/components/Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/_cn';

type ScanStatus = 'pending' | 'sent' | 'matched' | 'unmatched' | 'error';

type PhoneScan = {
  id: string;
  tracking: string;
  status: ScanStatus;
  sentAt: number;
  resultAt?: number;
  po_ids?: string[];
  errorMessage?: string;
};

const DUP_WINDOW_MS = 2000;

/** `?cam=off` hides preview and stops the camera; omit for preview on. */
const CAM_OFF = 'off';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MobileScanPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh w-full bg-white" aria-hidden />}>
      <MobileScanPageInner />
    </Suspense>
  );
}

function MobileScanPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoaded } = useAuth();
  const { getClient } = useAblyClient();
  const staffId = user?.staffId ?? 0;
  const cameraPreviewOpen = searchParams.get('cam') !== CAM_OFF;

  const phoneChannelRef = useRef<any>(null);
  const stationChannelRef = useRef<any>(null);

  const [scans, setScans] = useState<PhoneScan[]>([]);
  const [input, setInput] = useState('');
  const [autoSend, setAutoSend] = useState(true);

  const scanner = useBarcodeScanner({ dedupMs: DUP_WINDOW_MS });
  const feedback = useFeedback();

  const closeCameraPreview = useCallback(() => {
    router.replace(`/m/scan?cam=${CAM_OFF}`);
  }, [router]);

  // 1. Bounce to signin if no session.
  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace('/signin?next=/m/scan');
    }
  }, [isLoaded, user, router]);

  // 2. Attach to the shared Ably client and wire up channels keyed by staffId.
  useEffect(() => {
    if (staffId <= 0) return;
    let disposed = false;

    (async () => {
      const client = await getClient();
      if (disposed || !client) return;

      const phoneChannel = client.channels.get(`phone:${staffId}`);
      phoneChannelRef.current = phoneChannel;

      const stationChannel = client.channels.get(`station:${staffId}`);
      stationChannelRef.current = stationChannel;

      const onResult = (msg: { data?: { tracking?: string; matched?: boolean; po_ids?: string[]; error?: string } }) => {
        const data = msg.data;
        const tracking = (data?.tracking || '').trim();
        if (!tracking) return;
        setScans((prev) => prev.map((s) => {
          if (s.tracking !== tracking || s.status === 'matched' || s.status === 'unmatched') return s;
          if (data?.error) {
            return { ...s, status: 'error', errorMessage: data.error, resultAt: Date.now() };
          }
          return {
            ...s,
            status: data?.matched ? 'matched' : 'unmatched',
            po_ids: data?.po_ids ?? [],
            resultAt: Date.now(),
          };
        }));
      };
      stationChannel.subscribe('phone_scan_result', onResult);

      return () => {
        try { stationChannel.unsubscribe('phone_scan_result', onResult); } catch { /* noop */ }
        try { phoneChannel.detach(); } catch { /* noop */ }
        try { stationChannel.detach(); } catch { /* noop */ }
      };
    })();

    return () => {
      disposed = true;
      phoneChannelRef.current = null;
      stationChannelRef.current = null;
    };
  }, [staffId, getClient]);

  // 3. Send a tracking value — publishes on phone:{staffId}, adds optimistic chip.
  const sendScan = useCallback((rawValue: string) => {
    const tracking = rawValue.trim();
    if (!tracking) return;
    const channel = phoneChannelRef.current;
    if (!channel) return;

    const id = randomId();
    const now = Date.now();
    setScans((prev) => {
      const fresh: PhoneScan = { id, tracking, status: 'pending', sentAt: now };
      return [
        fresh,
        ...prev.filter((s) => s.tracking !== tracking || (s.status !== 'pending' && s.status !== 'sent')),
      ].slice(0, 12);
    });

    channel.publish('phone_scan', { tracking, at: now })
      .then(() => {
        setScans((prev) => prev.map((s) => s.id === id ? { ...s, status: 'sent' } : s));
      })
      .catch((err: unknown) => {
        setScans((prev) => prev.map((s) => s.id === id
          ? { ...s, status: 'error', errorMessage: err instanceof Error ? err.message : 'Publish failed' }
          : s));
      });

    feedback('confirm');
    setInput('');
  }, [feedback]);

  // 4. Start/stop camera with session + preview flag.
  useEffect(() => {
    if (staffId <= 0) return;
    if (!cameraPreviewOpen) {
      void scanner.stopScanning();
      return;
    }
    void scanner.startScanning();
    return () => {
      void scanner.stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, cameraPreviewOpen]);

  // React to decodes from the scanner (only meaningful while preview active).
  useEffect(() => {
    if (!cameraPreviewOpen) return;
    const value = scanner.lastScannedValue;
    if (!value) return;
    if (autoSend) {
      sendScan(value);
      scanner.acceptScan();
      window.setTimeout(() => scanner.resetLastScan(), 600);
    } else {
      setInput(value);
      feedback('scanAccepted');
      scanner.acceptScan();
      scanner.resetLastScan();
    }
  }, [cameraPreviewOpen, scanner.lastScannedValue, autoSend, sendScan, scanner, feedback]);

  if (!isLoaded || !user) return null;

  const theme = getStaffThemeById(staffId);
  const themeColors = stationThemeColors[theme];

  return (
    <div className="min-h-dvh w-full bg-white text-gray-900 flex flex-col">
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-gray-900 transition-[min-height] duration-200',
          cameraPreviewOpen ? 'min-h-[55vh] flex-1' : 'min-h-[6.5rem]',
        )}
      >
        {cameraPreviewOpen ? (
          <>
            <video
              ref={scanner.videoRef as React.RefObject<HTMLVideoElement>}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={`h-56 w-56 rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] ${themeColors.border.replace('border-', 'border-')}`} style={{ borderColor: 'currentColor' }} />
            </div>

            <div className="absolute inset-x-0 top-3 flex justify-between gap-2 px-3">
              <button
                type="button"
                onClick={closeCameraPreview}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/55 active:bg-black/65"
                aria-label="Close camera preview"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="ml-auto flex items-start gap-2">
                {scanner.isScanning && (
                  <button
                    type="button"
                    onClick={scanner.toggleTorch}
                    className={`rounded-full px-2 py-1 text-xs font-black uppercase tracking-widest ${scanner.torchOn ? 'bg-yellow-400/80 text-black' : 'bg-white/10 text-white/80'}`}
                    aria-label="Toggle flashlight"
                  >
                    ⚡
                  </button>
                )}
              </div>
            </div>

            {scanner.scanStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center gap-3">
                <p className="text-sm text-red-300 max-w-[280px]">
                  {scanner.error || 'Camera unavailable. Check browser permissions and reload.'}
                </p>
                <button
                  type="button"
                  onClick={() => void scanner.startScanning()}
                  className="rounded-lg bg-white/10 px-4 py-2 text-caption font-black uppercase tracking-widest text-white hover:bg-white/20"
                >
                  Try Again
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full min-h-[6.5rem] flex-col items-center justify-center gap-1 px-5 py-6 text-center">
            <p className="text-sm font-bold text-white/85">Camera preview off</p>
            <p className="max-w-[20rem] text-[11px] font-semibold uppercase tracking-wider text-white/45">
              Tap the Scan tab to turn it back on
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white p-3 space-y-3">
        <div>
          <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1">
            Tracking
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendScan(input); } }}
              placeholder="Scan or type…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-500"
            />
            <button
              type="button"
              onClick={() => sendScan(input)}
              disabled={!input.trim()}
              className={`rounded-lg px-4 py-2 text-label font-black uppercase tracking-wider text-white disabled:opacity-40 ${themeColors.bg} ${themeColors.hover}`}
            >
              Send
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Auto-send camera detections
          </label>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">
            Scans · {scans.length}
          </p>
          <div className="flex flex-col gap-1 max-h-40 overflow-auto">
            {scans.length === 0 ? (
              <p className="text-caption text-gray-400">Nothing yet.</p>
            ) : (
              scans.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={s.status} />
                    <span className="truncate font-mono text-label text-gray-800">{s.tracking}</span>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400 uppercase tracking-wider">
                    {statusLabel(s)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: ScanStatus }) {
  const cls = {
    pending: 'bg-blue-500 animate-pulse',
    sent: 'bg-blue-400',
    matched: 'bg-emerald-500',
    unmatched: 'bg-amber-500',
    error: 'bg-red-500',
  }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function statusLabel(s: PhoneScan): string {
  if (s.status === 'matched') {
    return s.po_ids && s.po_ids.length > 0 ? `PO ${s.po_ids[0]}` : 'Matched';
  }
  if (s.status === 'unmatched') return 'No PO';
  if (s.status === 'error') return s.errorMessage || 'Error';
  if (s.status === 'sent') return 'Looking up…';
  return 'Sending…';
}
