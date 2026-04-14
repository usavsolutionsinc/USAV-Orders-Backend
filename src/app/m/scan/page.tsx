'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Ably from 'ably';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type PairSession = {
  staff_id: number;
  staff_name?: string | null;
  phone_channel: string;
  station_channel: string;
  token_request: unknown;
  paired_at: number;
};

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

function loadSession(): PairSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem('usav.phonePair');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairSession;
    if (!parsed?.staff_id || !parsed.phone_channel || !parsed.token_request) return null;
    return parsed;
  } catch {
    return null;
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* silent — some browsers block without user gesture */
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MobileScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } | null>(null);
  const phoneChannelRef = useRef<Ably.RealtimeChannel | null>(null);
  const stationChannelRef = useRef<Ably.RealtimeChannel | null>(null);
  const realtimeRef = useRef<Ably.Realtime | null>(null);
  const lastDetectRef = useRef<{ value: string; at: number } | null>(null);
  const runningRef = useRef(false);

  const [session, setSession] = useState<PairSession | null>(null);
  const [connState, setConnState] = useState<string>('connecting');
  const [camState, setCamState] = useState<'idle' | 'ready' | 'denied' | 'unsupported'>('idle');
  const [scans, setScans] = useState<PhoneScan[]>([]);
  const [input, setInput] = useState('');
  const [autoSend, setAutoSend] = useState(true);

  // 1. Load the paired session (redirect if not paired).
  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.replace('/m/pair-needed');
      return;
    }
    setSession(s);
  }, [router]);

  // 2. Connect to Ably. Phone PUBLISHES on phone:{staff_id} and SUBSCRIBES on
  //    station:{staff_id} for scan-result echoes from the desktop.
  useEffect(() => {
    if (!session) return;
    const realtime = new Ably.Realtime({
      authCallback: (_params, cb) => {
        cb(null, session.token_request as Ably.TokenRequest);
      },
      clientId: `phone-${session.staff_id}`,
    });
    realtimeRef.current = realtime;

    const phoneChannel = realtime.channels.get(session.phone_channel);
    phoneChannelRef.current = phoneChannel;

    const stationChannel = realtime.channels.get(session.station_channel);
    stationChannelRef.current = stationChannel;

    const onState = (change: Ably.ConnectionStateChange) => setConnState(change.current);
    realtime.connection.on(onState);
    setConnState(realtime.connection.state);

    // Desktop echoes back results on this channel. Match by tracking string.
    const onResult = (msg: Ably.Message) => {
      const data = msg.data as {
        tracking?: string;
        matched?: boolean;
        po_ids?: string[];
        error?: string;
      } | undefined;
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
      realtime.connection.off(onState);
      try { phoneChannel.detach(); } catch { /* noop */ }
      try { stationChannel.detach(); } catch { /* noop */ }
      try { realtime.close(); } catch { /* noop */ }
      realtimeRef.current = null;
      phoneChannelRef.current = null;
      stationChannelRef.current = null;
    };
  }, [session]);

  // 3. Send a tracking value — publishes to phone channel, adds optimistic chip.
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
      .catch((err) => {
        setScans((prev) => prev.map((s) => s.id === id
          ? { ...s, status: 'error', errorMessage: err instanceof Error ? err.message : 'Publish failed' }
          : s));
      });

    vibrate(30);
    setInput('');
  }, []);

  // 4. Start camera + detection loop. Detection populates the input; user
  //    either lets auto-send fire, or edits first and taps Send.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function start() {
      const video = videoRef.current;
      if (!video) return;

      const BarcodeDetectorCtor = (window as unknown as {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => {
          detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
        };
      }).BarcodeDetector;
      if (!BarcodeDetectorCtor) {
        setCamState('unsupported');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play().catch(() => { /* ignore — Safari needs user gesture sometimes */ });
        detectorRef.current = new BarcodeDetectorCtor({ formats: ['qr_code', 'code_128', 'code_39'] });
        setCamState('ready');
        runningRef.current = true;
        scanTick();
      } catch (err) {
        console.warn('camera access denied', err);
        setCamState('denied');
      }
    }

    function handleDetected(value: string) {
      const now = Date.now();
      const last = lastDetectRef.current;
      if (last && last.value === value && now - last.at < DUP_WINDOW_MS) return;
      lastDetectRef.current = { value, at: now };

      if (autoSend) {
        sendScan(value);
      } else {
        // Park the value in the input so the user can edit + confirm.
        setInput(value);
        vibrate(15);
      }
    }

    function scanTick() {
      if (!runningRef.current || cancelled) return;
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector) {
        requestAnimationFrame(scanTick);
        return;
      }
      if (video.readyState >= 2) {
        void detector.detect(video).then((codes) => {
          if (codes.length > 0) {
            const raw = codes[0].rawValue.trim();
            if (raw) handleDetected(raw);
          }
        }).catch(() => { /* per-frame errors are fine */ });
      }
      setTimeout(() => requestAnimationFrame(scanTick), 100);
    }

    void start();
    return () => {
      cancelled = true;
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, autoSend, sendScan]);

  if (!session) return null;

  const theme = getStaffThemeById(session.staff_id);
  const themeColors = stationThemeColors[theme];

  return (
    <div className="min-h-dvh w-full bg-black text-white flex flex-col">
      <div className="relative flex-1 min-h-[55vh] overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={`h-56 w-56 rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] ${themeColors.border.replace('border-', 'border-')}`} style={{ borderColor: 'currentColor' }} />
        </div>
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
          <span className={`rounded-full px-2 py-1 text-white ${themeColors.bg}`}>
            {session.staff_name || `Staff #${session.staff_id}`}
          </span>
          <span
            className={`rounded-full px-2 py-1 ${
              connState === 'connected' ? 'bg-emerald-500/80' : 'bg-amber-500/80'
            }`}
          >
            {connState}
          </span>
        </div>
        {camState === 'denied' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center">
            <p className="text-sm text-red-300">
              Camera access denied. Enable camera permission in Settings and reload.
            </p>
          </div>
        )}
        {camState === 'unsupported' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center">
            <p className="text-sm text-amber-300">
              QR scanning isn't supported on this browser. Use the manual input below.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 bg-gray-950 p-3 space-y-3">
        {/* Editable tracking input — camera detections populate this, you can
            fix typos, then Send. Enter submits. */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-white/50 mb-1">
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
              className="flex-1 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[14px] font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-white/60"
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
          <label className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/50">
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
          <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-1">
            Scans · {scans.length}
          </p>
          <div className="flex flex-col gap-1 max-h-40 overflow-auto">
            {scans.length === 0 ? (
              <p className="text-[11px] text-white/30">Nothing yet.</p>
            ) : (
              scans.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded border border-white/10 bg-white/5 px-2 py-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={s.status} />
                    <span className="truncate font-mono text-[12px] text-white/90">{s.tracking}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-white/40 uppercase tracking-wider">
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
    pending: 'bg-blue-400 animate-pulse',
    sent: 'bg-blue-300',
    matched: 'bg-emerald-400',
    unmatched: 'bg-amber-400',
    error: 'bg-red-400',
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
