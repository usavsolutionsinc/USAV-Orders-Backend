'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFeedback } from '@/hooks/useFeedback';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';

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

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MobileScanPage() {
  const router = useRouter();
  const { user, isLoaded } = useAuth();
  const { getClient } = useAblyClient();
  const staffId = user?.staffId ?? 0;
  const staffName = (user as { name?: string } | null)?.name ?? null;

  const phoneChannelRef = useRef<any>(null);
  const stationChannelRef = useRef<any>(null);

  const [connState, setConnState] = useState<string>('connecting');
  const [scans, setScans] = useState<PhoneScan[]>([]);
  const [input, setInput] = useState('');
  const [autoSend, setAutoSend] = useState(true);

  const scanner = useBarcodeScanner({ dedupMs: DUP_WINDOW_MS });
  const feedback = useFeedback();

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

      const onState = (change: { current: string }) => setConnState(change.current);
      client.connection.on(onState);
      setConnState(client.connection.state);

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
        client.connection.off(onState);
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

  // 4. Start/stop camera with the signed-in session.
  useEffect(() => {
    if (staffId <= 0) return;
    void scanner.startScanning();
    return () => {
      void scanner.stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  // React to decodes from the scanner.
  useEffect(() => {
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
  }, [scanner.lastScannedValue, autoSend, sendScan, scanner, feedback]);

  if (!isLoaded || !user) return null;

  const theme = getStaffThemeById(staffId);
  const themeColors = stationThemeColors[theme];

  return (
    <div className="min-h-dvh w-full bg-white text-gray-900 flex flex-col">
      <div className="relative flex-1 min-h-[55vh] overflow-hidden bg-gray-900">
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
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-xs font-black uppercase tracking-widest">
          <span className={`rounded-full px-2 py-1 text-white ${themeColors.bg}`}>
            {staffName || `Staff #${staffId}`}
          </span>
          <div className="flex items-center gap-2">
            {scanner.isScanning && (
              <button
                type="button"
                onClick={scanner.toggleTorch}
                className={`rounded-full px-2 py-1 ${scanner.torchOn ? 'bg-yellow-400/80 text-black' : 'bg-white/10 text-white/80'}`}
                aria-label="Toggle flashlight"
              >
                ⚡
              </button>
            )}
            <span
              className={`rounded-full px-2 py-1 ${
                connState === 'connected' ? 'bg-emerald-500/80' : 'bg-amber-500/80'
              }`}
            >
              {connState}
            </span>
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
              className="rounded-lg bg-white/10 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white hover:bg-white/20"
            >
              Try Again
            </button>
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
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-500"
            />
            <button
              type="button"
              onClick={() => sendScan(input)}
              disabled={!input.trim()}
              className={`rounded-lg px-4 py-2 text-[12px] font-black uppercase tracking-wider text-white disabled:opacity-40 ${themeColors.bg} ${themeColors.hover}`}
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
              <p className="text-[11px] text-gray-400">Nothing yet.</p>
            ) : (
              scans.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={s.status} />
                    <span className="truncate font-mono text-[12px] text-gray-800">{s.tracking}</span>
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
