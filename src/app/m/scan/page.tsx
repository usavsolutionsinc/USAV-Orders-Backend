'use client';

/**
 * /m/scan — Universal mobile scan entry point.
 *
 * This page is the destination of the center "Scan" button on the mobile
 * bottom nav. Its job:
 *
 *   1. Capture a Data Matrix / QR / barcode from the camera (or manual entry).
 *   2. Call /api/scan/resolve to classify the payload and look up matching
 *      orders.
 *   3. Route to /m/orders/[orderId] when there is exactly one match.
 *      Render an inline chooser when multiple match.
 *      Show fallback affordances ("Log unknown") when nothing matches.
 *
 * IMPORTANT DESIGN INVARIANT — read before changing anything:
 *
 *   The mobile center scan button is NOT a receiving entry point. It must
 *   NEVER publish to the Ably `phone:{staffId}` channel (which the receiving
 *   station listens to and writes through to the receiving database table),
 *   and it must NEVER call any /api/receiving* endpoint.
 *
 *   The mobile app's primary use case is: scan → detail page → edit via the
 *   bottom sheet. Receiving is a dedicated station flow reached from the
 *   /m/home cockpit, not from this universal scanner.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from '@/components/Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/_cn';

type ResolveStatus = 'idle' | 'resolving' | 'resolved' | 'multi' | 'none' | 'error';

type ResolvedOrder = {
  id: number;
  order_id: string;
  sku: string | null;
  product_title: string | null;
  status: string | null;
};

type ScanRecord = {
  id: string;
  raw: string;
  status: ResolveStatus;
  orders: ResolvedOrder[];
  kind?: string;
  scannedAt: number;
};

interface ResolveResponse {
  ok: true;
  kind: string;
  source: string;
  raw: string;
  matches: ResolvedOrder[];
  matchOutcome: 'single' | 'multi' | 'none';
  mobileRoute: string | null;
}

const DUP_WINDOW_MS = 2000;
const RECENT_KEY = 'mobile.scan.recent';
const RECENT_LIMIT = 20;

const CAM_OFF = 'off';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadRecent(): ScanRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(records: ScanRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(records.slice(0, RECENT_LIMIT)));
  } catch {
    /* quota / disabled — ignore */
  }
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
  const staffId = user?.staffId ?? 0;
  const cameraPreviewOpen = searchParams.get('cam') !== CAM_OFF;

  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [input, setInput] = useState('');
  const [autoSend, setAutoSend] = useState(true);

  const scanner = useBarcodeScanner({ dedupMs: DUP_WINDOW_MS });
  const feedback = useFeedback();

  // Last-N recent scans persist across visits via localStorage.
  useEffect(() => {
    setScans(loadRecent());
  }, []);

  const closeCameraPreview = useCallback(() => {
    router.replace(`/m/scan?cam=${CAM_OFF}`);
  }, [router]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace('/signin?next=/m/scan');
    }
  }, [isLoaded, user, router]);

  /**
   * resolveScan
   * ──────────────────────────────────────────────────────────────────────
   * Send raw scan payload to /api/scan/resolve. Routes the UI based on
   * the response — NEVER publishes to receiving channels and NEVER posts
   * to /api/receiving*.
   */
  const resolveScan = useCallback(async (rawValue: string) => {
    const raw = rawValue.trim();
    if (!raw) return;

    const id = randomId();
    const pending: ScanRecord = {
      id,
      raw,
      status: 'resolving',
      orders: [],
      scannedAt: Date.now(),
    };
    setScans((prev) => {
      const next = [pending, ...prev.filter((s) => s.raw !== raw)].slice(0, RECENT_LIMIT);
      saveRecent(next);
      return next;
    });
    feedback('confirm');
    setInput('');

    try {
      const res = await fetch('/api/scan/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          input: raw,
          device: typeof navigator !== 'undefined' ? {
            ua: navigator.userAgent,
            platform: 'mobile-web',
          } : null,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ResolveResponse = await res.json();

      const nextStatus: ResolveStatus =
        data.matchOutcome === 'single' ? 'resolved'
        : data.matchOutcome === 'multi' ? 'multi'
        : 'none';

      setScans((prev) => {
        const next = prev.map((s) => s.id === id
          ? { ...s, status: nextStatus, orders: data.matches, kind: data.kind }
          : s);
        saveRecent(next);
        return next;
      });

      // Single match → route straight to detail page. This is the
      // happy-path use case: scan → detail page → edit via bottom sheet.
      if (data.mobileRoute && data.matchOutcome === 'single') {
        feedback('scanAccepted');
        // Defer the navigation slightly so the user sees the resolved chip.
        window.setTimeout(() => router.push(data.mobileRoute as string), 220);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Resolve failed';
      setScans((prev) => {
        const next = prev.map((s) => s.id === id
          ? { ...s, status: 'error' as ResolveStatus, kind: msg }
          : s);
        saveRecent(next);
        return next;
      });
    }
  }, [feedback, router]);

  // Camera lifecycle.
  useEffect(() => {
    if (staffId <= 0) return;
    if (!cameraPreviewOpen) {
      void scanner.stopScanning();
      return;
    }
    void scanner.startScanning();
    return () => { void scanner.stopScanning(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, cameraPreviewOpen]);

  // Camera decode → resolve.
  useEffect(() => {
    if (!cameraPreviewOpen) return;
    const value = scanner.lastScannedValue;
    if (!value) return;
    if (autoSend) {
      void resolveScan(value);
      scanner.acceptScan();
      window.setTimeout(() => scanner.resetLastScan(), 600);
    } else {
      setInput(value);
      feedback('scanAccepted');
      scanner.acceptScan();
      scanner.resetLastScan();
    }
  }, [cameraPreviewOpen, scanner.lastScannedValue, autoSend, resolveScan, scanner, feedback]);

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
            {/* Square reticle sized for Data Matrix (dense, ~60% of width). */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="aspect-square w-[60vw] max-w-[300px] rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                style={{ borderColor: 'currentColor' }}
              />
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
            Scan or type code
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void resolveScan(input); } }}
              placeholder="Tracking, serial, order #…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-500"
            />
            <button
              type="button"
              onClick={() => void resolveScan(input)}
              disabled={!input.trim()}
              className={`rounded-lg px-4 py-2 text-label font-black uppercase tracking-wider text-white disabled:opacity-40 ${themeColors.bg} ${themeColors.hover}`}
            >
              Find
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Auto-resolve camera detections
          </label>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">
            Recent · {scans.length}
          </p>
          <div className="flex flex-col gap-1 max-h-60 overflow-auto">
            {scans.length === 0 ? (
              <p className="text-caption text-gray-400">Nothing yet — point the camera at a code.</p>
            ) : (
              scans.map((s) => <ScanRow key={s.id} record={s} onTapOrder={(orderId) => router.push(`/m/orders/${encodeURIComponent(orderId)}`)} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanRow({ record, onTapOrder }: { record: ScanRecord; onTapOrder: (orderId: string) => void }) {
  const single = record.status === 'resolved' && record.orders.length === 1;
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-label">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={record.status} />
          <span className="truncate font-mono text-gray-800">{record.raw}</span>
        </div>
        <span className="shrink-0 text-xs text-gray-400 uppercase tracking-wider">
          {statusLabel(record)}
        </span>
      </div>
      {record.status === 'multi' && record.orders.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {record.orders.slice(0, 5).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onTapOrder(o.order_id)}
              className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-left text-xs hover:bg-gray-100"
            >
              <span className="font-mono font-bold text-gray-900">{o.order_id}</span>
              <span className="truncate text-gray-500">{o.sku ?? '—'}</span>
            </button>
          ))}
        </div>
      )}
      {single && (
        <button
          type="button"
          onClick={() => onTapOrder(record.orders[0].order_id)}
          className="mt-1 text-xs font-bold uppercase tracking-wider text-blue-600"
        >
          Open {record.orders[0].order_id} →
        </button>
      )}
      {record.status === 'none' && (
        <p className="mt-1 text-xs text-gray-500">No order matched. Try another label, or log it from /m/home → Receiving station.</p>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ResolveStatus }) {
  const cls = {
    idle: 'bg-gray-300',
    resolving: 'bg-blue-500 animate-pulse',
    resolved: 'bg-emerald-500',
    multi: 'bg-amber-500',
    none: 'bg-gray-400',
    error: 'bg-red-500',
  }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function statusLabel(s: ScanRecord): string {
  switch (s.status) {
    case 'resolving': return 'Looking up…';
    case 'resolved': return s.orders[0] ? `→ ${s.orders[0].order_id}` : 'Matched';
    case 'multi': return `${s.orders.length} orders`;
    case 'none': return 'No match';
    case 'error': return s.kind ?? 'Error';
    default: return '';
  }
}
