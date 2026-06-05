'use client';

/**
 * /m/receive — Mobile receiving-door scan entry point.
 *
 * Destination of the center "Receive" button on the mobile bottom nav. Its job:
 *
 *   1. Capture a tracking barcode from the camera (or manual entry) as a
 *      package arrives at the receiving door.
 *   2. Call POST /api/receiving/lookup-po to ping Zoho and, if the tracking is
 *      known, record the *scanned-at-door* receipt — this writes
 *      receiving.received_at / received_by and a receiving_scans audit row
 *      (staffId comes from the verified session, not the client).
 *   3. Show the matched PO + line items so the operator knows what arrived.
 *      Unknown trackings are logged as exceptions for the reconciliation worker.
 *
 * This is the *door scan* (first touch). It does NOT unbox — unboxing stays the
 * existing per-line desktop flow (mark-received, which sets unboxed_at). This
 * page is the receiving counterpart to /m/scan (universal order scanner); unlike
 * /m/scan, calling /api/receiving/* here is the whole point.
 *
 * When a scanned line's SKU is needed by a currently-pending order, the response
 * carries `pending_order_skus` and we surface an "Unbox first" badge (the header
 * inbox alert is wired in a later phase).
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from '@/components/Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/_cn';

type ReceiveStatus =
  | 'scanning'
  | 'matched'
  | 'deduped'
  | 'unmatched'
  | 'unreachable'
  | 'error';

interface ReceiveLine {
  id: number;
  sku: string | null;
  item_name: string | null;
  image_url: string | null;
  zoho_item_id: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
}

interface LookupPoResponse {
  success: boolean;
  receiving_id: number;
  scan_id: number;
  preexisting?: boolean;
  deduped?: boolean;
  matched: boolean;
  po_matched: boolean;
  po_ids: string[];
  secondary_po_ids?: string[];
  multi_po_warning?: boolean;
  zoho_reachable?: boolean;
  exception_reason?: string | null;
  /** SKUs on this carton that are needed by a currently-pending order. */
  pending_order_skus?: string[];
  lines: ReceiveLine[];
  error?: string;
}

type ReceiveRecord = {
  id: string;
  tracking: string;
  status: ReceiveStatus;
  poIds: string[];
  lines: ReceiveLine[];
  pendingSkus: string[];
  multiPoWarning: boolean;
  receivingId: number | null;
  note?: string;
  scannedAt: number;
};

const DUP_WINDOW_MS = 2000;
const RECENT_KEY = 'mobile.receive.recent';
const RECENT_LIMIT = 20;
const CAM_OFF = 'off';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * POST the door scan with a short retry on transient network failures so a
 * blip on warehouse wifi during fast bulk scans doesn't silently drop a
 * carton. Only network errors retry; an HTTP response (even non-2xx) is
 * returned to the caller to handle. The receiving row is idempotent on
 * tracking server-side, so a retried scan can't double-create.
 */
async function postScanWithRetry(tracking: string, attempts = 3): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch('/api/receiving/lookup-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ trackingNumber: tracking }),
      });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr ?? new Error('Network error');
}

function loadRecent(): ReceiveRecord[] {
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

function saveRecent(records: ReceiveRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(records.slice(0, RECENT_LIMIT)));
  } catch {
    /* quota / disabled — ignore */
  }
}

export default function MobileReceivePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh w-full bg-white" aria-hidden />}>
      <MobileReceivePageInner />
    </Suspense>
  );
}

function MobileReceivePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoaded } = useAuth();
  const staffId = user?.staffId ?? 0;
  const cameraPreviewOpen = searchParams.get('cam') !== CAM_OFF;

  const [scans, setScans] = useState<ReceiveRecord[]>([]);
  const [input, setInput] = useState('');
  const [autoSend, setAutoSend] = useState(true);

  const scanner = useBarcodeScanner({ dedupMs: DUP_WINDOW_MS });
  const feedback = useFeedback();

  useEffect(() => {
    setScans(loadRecent());
  }, []);

  const closeCameraPreview = useCallback(() => {
    router.replace(`/m/receive?cam=${CAM_OFF}`);
  }, [router]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) router.replace('/signin?next=/m/receive');
  }, [isLoaded, user, router]);

  /**
   * receiveScan
   * ──────────────────────────────────────────────────────────────────────
   * POST the tracking to /api/receiving/lookup-po. This records the door
   * receipt (received_at/received_by + receiving_scans) when Zoho knows the
   * tracking; unknown trackings are logged as exceptions server-side.
   */
  const receiveScan = useCallback(async (rawValue: string) => {
    const tracking = rawValue.trim();
    if (!tracking) return;

    const id = randomId();
    const pending: ReceiveRecord = {
      id,
      tracking,
      status: 'scanning',
      poIds: [],
      lines: [],
      pendingSkus: [],
      multiPoWarning: false,
      receivingId: null,
      scannedAt: Date.now(),
    };
    setScans((prev) => {
      const next = [pending, ...prev.filter((s) => s.tracking !== tracking)].slice(0, RECENT_LIMIT);
      saveRecent(next);
      return next;
    });
    feedback('confirm');
    setInput('');

    const patch = (changes: Partial<ReceiveRecord>) => {
      setScans((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...changes } : s));
        saveRecent(next);
        return next;
      });
    };

    try {
      const res = await postScanWithRetry(tracking);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LookupPoResponse = await res.json();
      if (!data.success) throw new Error(data.error || 'Lookup failed');

      const pendingSkus = data.pending_order_skus ?? [];

      if (data.matched) {
        patch({
          status: data.deduped ? 'deduped' : 'matched',
          poIds: data.po_ids ?? [],
          lines: data.lines ?? [],
          pendingSkus,
          multiPoWarning: Boolean(data.multi_po_warning),
          receivingId: data.receiving_id,
          note: data.deduped ? 'Already scanned' : undefined,
        });
        feedback('scanAccepted');
      } else {
        const unreachable = data.exception_reason === 'zoho_unreachable' || data.zoho_reachable === false;
        patch({
          status: unreachable ? 'unreachable' : 'unmatched',
          receivingId: data.receiving_id,
          note: unreachable ? 'Zoho unreachable — logged for retry' : 'Not in Zoho yet — logged',
        });
      }
    } catch (err) {
      patch({ status: 'error', note: err instanceof Error ? err.message : 'Scan failed' });
    }
  }, [feedback]);

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

  // Camera decode → receive.
  useEffect(() => {
    if (!cameraPreviewOpen) return;
    const value = scanner.lastScannedValue;
    if (!value) return;
    if (autoSend) {
      void receiveScan(value);
      scanner.acceptScan();
      window.setTimeout(() => scanner.resetLastScan(), 600);
    } else {
      setInput(value);
      feedback('scanAccepted');
      scanner.acceptScan();
      scanner.resetLastScan();
    }
  }, [cameraPreviewOpen, scanner.lastScannedValue, autoSend, receiveScan, scanner, feedback]);

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
              <div
                className="aspect-[3/2] w-[72vw] max-w-[340px] rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
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
                <span className="rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-white/90 backdrop-blur-sm">
                  Receiving door
                </span>
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
              Tap the Receive tab to turn it back on
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white p-3 space-y-3">
        <div>
          <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1">
            Scan or type tracking #
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void receiveScan(input); } }}
              placeholder="Carrier tracking number…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-500"
            />
            <button
              type="button"
              onClick={() => void receiveScan(input)}
              disabled={!input.trim()}
              className={`rounded-lg px-4 py-2 text-label font-black uppercase tracking-wider text-white disabled:opacity-40 ${themeColors.bg} ${themeColors.hover}`}
            >
              Receive
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Auto-receive camera detections
          </label>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-gray-500">
              Received · {scans.length}
            </p>
            <button
              type="button"
              onClick={() => router.push('/m/receiving/history')}
              className="text-xs font-bold uppercase tracking-wider text-blue-600"
            >
              History →
            </button>
          </div>
          <div className="flex flex-col gap-1 max-h-[18rem] overflow-auto">
            {scans.length === 0 ? (
              <p className="text-caption text-gray-400">Nothing yet — scan a package as it comes in.</p>
            ) : (
              scans.map((s) => <ReceiveRow key={s.id} record={s} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiveRow({ record }: { record: ReceiveRecord }) {
  const priority = record.pendingSkus.length > 0;
  return (
    <div
      className={cn(
        'rounded border px-2 py-1.5 text-label',
        priority ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-gray-50',
      )}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={record.status} />
          <span className="truncate font-mono text-gray-800">{record.tracking}</span>
        </div>
        <span className="shrink-0 text-xs text-gray-400 uppercase tracking-wider">
          {statusLabel(record)}
        </span>
      </div>

      {priority && (
        <p className="mt-1 inline-flex items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
          Unbox first · on pending order
        </p>
      )}

      {record.poIds.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          PO {record.poIds.join(', ')}
          {record.multiPoWarning ? ' · multiple POs — triage' : ''}
        </p>
      )}

      {record.lines.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {record.lines.slice(0, 6).map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-gray-700">{l.item_name ?? l.sku ?? '—'}</span>
              <span className="shrink-0 font-mono text-gray-400">{l.sku ?? l.zoho_item_id ?? ''}</span>
            </div>
          ))}
          {record.lines.length > 6 && (
            <span className="text-[11px] text-gray-400">+{record.lines.length - 6} more</span>
          )}
        </div>
      )}

      {record.note && (record.status === 'unmatched' || record.status === 'unreachable' || record.status === 'error' || record.status === 'deduped') && (
        <p className="mt-1 text-xs text-gray-500">{record.note}</p>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: ReceiveStatus }) {
  const cls = {
    scanning: 'bg-blue-500 animate-pulse',
    matched: 'bg-emerald-500',
    deduped: 'bg-amber-500',
    unmatched: 'bg-gray-400',
    unreachable: 'bg-orange-500',
    error: 'bg-red-500',
  }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function statusLabel(r: ReceiveRecord): string {
  switch (r.status) {
    case 'scanning': return 'Receiving…';
    case 'matched': return r.poIds[0] ? `✓ ${r.poIds[0]}` : 'Received';
    case 'deduped': return 'Already in';
    case 'unmatched': return 'Not in Zoho';
    case 'unreachable': return 'Retry queued';
    case 'error': return 'Error';
    default: return '';
  }
}
