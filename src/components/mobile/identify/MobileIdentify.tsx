'use client';

/**
 * Mobile "Identify by photo" — camera-first product identify for receiving /
 * local-pickup intake. Snap the printed label → the LAN vision box OCRs the Bose
 * model → the server resolves it to a catalog SKU → operator confirms → the line
 * is added to the carton. Built for rapid one-handed intake (camera re-arms after
 * each add). See docs/visual-receiving-identify-plan.md.
 *
 * Reliability model (industry standard): exact-first, human-confirmed. The label
 * OCR is the trusted signal; we show the text it read + never silent-commit — the
 * operator taps Add. No-label / not-in-catalog both degrade to clear next actions.
 *
 * URL params: ?recvId=<receiving id>&po=<human PO ref>. Without recvId the page
 * still identifies (read-only) but Add is disabled with a hint.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Check, X, RotateCcw, Loader2, AlertTriangle, Search, Zap } from '@/components/Icons';
import { useCamera } from '@/hooks/useCamera';
import { toast } from '@/lib/toast';
import { useLabelIdentify } from '@/components/receiving/label-identify/useLabelIdentify';
import { useLiveLabelScan } from '@/components/receiving/label-identify/useLiveLabelScan';
import type { GateReason } from '@/lib/vision/frame-quality';
import type { LabelCandidate } from '@/lib/vision-identify';

type ScanMode = 'live' | 'manual';
const SCAN_MODE_KEY = 'usav.identify.scanMode';

/** Reticle border colour by gate state — green when a frame is good enough to send. */
const RETICLE_TINT: Record<GateReason, string> = {
  ok: 'border-emerald-400',
  moving: 'border-amber-300/80',
  blurry: 'border-amber-300/80',
  dark: 'border-white/40',
  'too-bright': 'border-amber-300/80',
};

interface AddedItem {
  id: string;
  title: string;
  lineId?: number;
}

export function MobileIdentify() {
  const params = useSearchParams();
  const recvId = Number(params.get('recvId')) || null;
  const poRef = params.get('po');

  const { videoRef, startCamera, stopCamera, cameraError } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState<string | null>(null); // freeze-frame while reading
  const [added, setAdded] = useState<AddedItem[]>([]);
  const [adding, setAdding] = useState(false);
  /** Last confirmed item — drives the success bottom sheet before the camera re-arms. */
  const [confirmed, setConfirmed] = useState<AddedItem | null>(null);

  // Live (hands-free) vs manual (tap-shutter) capture. Live is the default; manual is
  // the always-available fallback. Last choice is remembered per device.
  const [mode, setMode] = useState<ScanMode>('live');
  const modeRef = useRef<ScanMode>('live');
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(SCAN_MODE_KEY)) as ScanMode | null;
    if (saved === 'live' || saved === 'manual') { setMode(saved); modeRef.current = saved; }
  }, []);

  const { status, candidates, rawText, error, identify, identifyOnce, applyResult, reset } = useLabelIdentify();
  const liveScan = useLiveLabelScan({ videoRef, identifyOnce });
  // Stable action handles (the liveScan object itself is a fresh literal each render).
  const { start: startLiveScan, stop: stopLiveScan, reset: resetLiveScan } = liveScan;

  // Start the rear camera; retry once at default resolution.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await startCamera({ facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } });
      } catch {
        if (!cancelled) {
          try { await startCamera({ facingMode: 'environment' }); } catch { /* surfaced via cameraError */ }
        }
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [startCamera, stopCamera]);

  // Capture the current video frame → blob → identify. Freeze the frame so the
  // "reading" state shows what was shot (no spinner-in-void).
  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFrozen(canvas.toDataURL('image/jpeg', 0.7));
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (blob) await identify(blob);
  }, [identify, videoRef]);

  const retake = useCallback(() => {
    setFrozen(null);
    setConfirmed(null);
    reset();
    // In live mode, re-arm the scan loop for the next item; manual waits for a tap.
    if (modeRef.current === 'live') { resetLiveScan(); startLiveScan(); }
  }, [reset, resetLiveScan, startLiveScan]);

  // Switch capture modes: start/stop the live loop and remember the choice.
  const switchMode = useCallback(
    (next: ScanMode) => {
      modeRef.current = next;
      setMode(next);
      try { localStorage.setItem(SCAN_MODE_KEY, next); } catch { /* private mode */ }
      setFrozen(null);
      reset();
      if (next === 'live') { resetLiveScan(); startLiveScan(); }
      else stopLiveScan();
    },
    [reset, resetLiveScan, startLiveScan, stopLiveScan],
  );

  // Kick off the live loop once on mount when live mode is active. The loop self-guards
  // until the camera is ready (videoWidth>0), so starting early is safe.
  useEffect(() => {
    if (modeRef.current === 'live') startLiveScan();
    return () => stopLiveScan();
  }, [startLiveScan, stopLiveScan]);

  // When the live loop LOCKS (consensus reached) or errors, feed the result into the
  // shared identify state so the existing results / error sheet renders unchanged.
  useEffect(() => {
    if (liveScan.phase === 'locked') {
      setFrozen(liveScan.frozen);
      applyResult({ ok: true, candidates: liveScan.candidates, rawText: liveScan.rawText });
    } else if (liveScan.phase === 'error' && liveScan.error) {
      applyResult({ ok: false, candidates: [], rawText: '', error: liveScan.error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveScan.phase]);

  // After a confirm, the success sheet shows briefly, then the camera re-arms for
  // the next item (rapid intake). Operator can also tap "Next item" to skip the wait.
  useEffect(() => {
    if (!confirmed) return;
    const t = setTimeout(() => retake(), 1800);
    return () => clearTimeout(t);
  }, [confirmed, retake]);

  // Confirm a candidate → add the receiving line (the same idempotent path the
  // desktop CartonAddPopover uses). Re-arms the camera for the next item.
  const confirm = useCallback(
    async (c: LabelCandidate) => {
      if (!recvId) { toast.error('Open this from a carton to add items.'); return; }
      setAdding(true);
      const clientEventId = `m-identify-${recvId}-${c.zoho_item_id ?? c.model}-${added.length}`;
      try {
        const res = await fetch('/api/receiving/add-unmatched-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientEventId },
          body: JSON.stringify({
            receiving_id: recvId,
            sku_catalog_id: c.sku_catalog_id,
            sku: c.sku || undefined,
            item_name: c.product_title ?? c.item_name ?? c.model,
            intake_type: 'po',
            client_event_id: clientEventId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) { toast.error(body.error ?? 'Add failed'); return; }
        const item: AddedItem = { id: clientEventId, title: c.product_title ?? c.model, lineId: body.line?.id };
        setAdded((xs) => [item, ...xs]);
        // Show the success bottom sheet (keeps the freeze-frame behind it) before
        // re-arming — confirmation is visible, not a silent snap-back to camera.
        setConfirmed(item);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Add failed');
      } finally {
        setAdding(false);
      }
    },
    [added.length, recvId],
  );

  const isLive = mode === 'live';
  // Live mode runs the scan loop; manual waits for the shutter. These drive the overlays.
  const liveScanning = isLive && liveScan.phase === 'scanning';
  const manualIdle = !isLive && status === 'idle' && !frozen;
  const reading = status === 'identifying' || (isLive && liveScan.phase === 'reading');

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#0B0B0F] text-white">
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <button onClick={() => history.back()} className="flex items-center gap-1 text-sm text-white/70">
          <X className="h-5 w-5" /> Identify
        </button>

        {/* Live / Manual capture toggle */}
        <div className="flex items-center rounded-full bg-white/10 p-0.5 text-xs font-medium">
          <button
            onClick={() => switchMode('live')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${isLive ? 'bg-emerald-500 text-black' : 'text-white/70'}`}
          >
            <Zap className="h-3.5 w-3.5" /> Live
          </button>
          <button
            onClick={() => switchMode('manual')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${!isLive ? 'bg-white text-black' : 'text-white/70'}`}
          >
            <Camera className="h-3.5 w-3.5" /> Manual
          </button>
        </div>

        {poRef ? (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium tabular-nums">PO {poRef}</span>
        ) : recvId ? (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">Carton #{recvId}</span>
        ) : (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs text-amber-300">view-only</span>
        )}
      </div>

      {/* Viewfinder (live) or freeze-frame */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${frozen ? 'opacity-0' : 'opacity-100'}`}
        />
        {frozen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozen} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Manual aim reticle (manual mode, waiting for shutter) */}
      {manualIdle && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
          <motion.div
            initial={{ opacity: 0.5 }}
            animate={{ opacity: [0.5, 0.9, 0.5] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
            className="h-44 w-72 rounded-2xl border-2 border-dashed border-white/70"
          />
          <p className="mt-4 text-sm text-white/80">Aim at the printed label on the bottom</p>
        </div>
      )}

      {/* Live reticle — border tints by frame quality; green = good enough to read */}
      {liveScanning && !frozen && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
          <motion.div
            animate={{ scale: liveScan.gateReason === 'ok' ? [1, 1.02, 1] : 1 }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
            className={`h-44 w-72 rounded-2xl border-2 transition-colors ${RETICLE_TINT[liveScan.gateReason]}`}
          />
          <p className="mt-4 flex items-center gap-1.5 text-sm text-white/80">
            <Zap className="h-4 w-4 text-emerald-400" /> {liveScan.hint || 'Aim at the printed label'}
          </p>
        </div>
      )}

      {/* Reading scan-line (manual identify or live read in flight) */}
      {reading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
          <motion.div
            initial={{ y: -90 }}
            animate={{ y: 90 }}
            transition={{ repeat: Infinity, repeatType: 'reverse', duration: 0.9, ease: 'easeInOut' }}
            className="h-0.5 w-72 bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.7)]"
          />
          <span className="absolute bottom-32 flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading label…
          </span>
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-xl bg-white/10 p-4 text-center text-sm text-white/80">
          Camera unavailable ({cameraError}). Check permissions, then reload.
        </div>
      )}

      {/* Manual shutter */}
      {manualIdle && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {added.length > 0 && <SessionList added={added} />}
          <button
            onClick={() => void capture()}
            aria-label="Capture"
            className="h-[72px] w-[72px] rounded-full border-4 border-white/80 bg-white/95 shadow-lg active:scale-95"
          />
        </div>
      )}

      {/* Live mode bottom bar — session list + hands-free indicator (no shutter) */}
      {isLive && !frozen && (liveScan.phase === 'scanning' || liveScan.phase === 'reading' || liveScan.phase === 'idle') && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {added.length > 0 && <SessionList added={added} />}
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs text-white/70">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Scanning — hold the label in view
          </div>
        </div>
      )}

      {/* Confirmed success sheet — shown after Add, before the camera re-arms. */}
      <AnimatePresence>
        {confirmed && (
          <motion.div
            key="confirmed"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-[#15151B] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <div className="space-y-4 text-center">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500"
              >
                <Check className="h-8 w-8 text-black" />
              </motion.div>
              <div>
                <div className="text-base font-semibold">{confirmed.title}</div>
                <div className="mt-0.5 text-sm text-white/50">
                  Added to {poRef ? `PO ${poRef}` : `carton #${recvId}`}
                  {added.length > 1 ? ` · ${added.length} this session` : ''}
                </div>
              </div>
              <button
                onClick={retake}
                className="w-full rounded-xl bg-white py-3.5 text-sm font-semibold text-black active:scale-[0.99]"
              >
                Next item
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result / no-match sheet (hidden once a candidate is confirmed) */}
      <AnimatePresence>
        {!confirmed && (status === 'results' || status === 'error') && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl bg-[#15151B] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />

            {status === 'error' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-amber-300">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={retake} className="flex-1 rounded-xl bg-white py-3 text-sm font-semibold text-black">
                    Retake
                  </button>
                  <button
                    onClick={() => recvId && (window.location.href = `/m/receive/${recvId}`)}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white/80"
                  >
                    <Search className="h-4 w-4" /> Search
                  </button>
                </div>
              </div>
            )}

            {status === 'results' && (
              <div className="space-y-2">
                <div className="px-1 text-xs font-medium uppercase tracking-wide text-white/40">
                  Confirm the product
                </div>
                {candidates.map((c, i) => (
                  <CandidateCard key={`${c.model}-${i}`} c={c} primary={i === 0} adding={adding} canAdd={!!recvId} onAdd={confirm} />
                ))}
                {rawText && (
                  <p className="px-1 pt-1 text-[11px] text-white/30">read: “{rawText.slice(0, 90)}”</p>
                )}
                <button onClick={retake} className="mt-1 inline-flex items-center gap-1.5 px-1 text-xs text-white/50">
                  <RotateCcw className="h-3 w-3" /> Retake
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CandidateCard({
  c, primary, adding, canAdd, onAdd,
}: {
  c: LabelCandidate;
  primary: boolean;
  adding: boolean;
  canAdd: boolean;
  onAdd: (c: LabelCandidate) => void;
}) {
  const title = c.product_title ?? c.item_name ?? c.model;
  return (
    <div className={`flex items-center gap-3 rounded-2xl p-3 ${primary ? 'bg-white/[0.06] ring-1 ring-emerald-500/40' : 'bg-white/[0.03]'}`}>
      {c.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-white/40">
          <Camera className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
          {c.sku ? <span className="tabular-nums">SKU {c.sku}</span> : <span>no SKU</span>}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
            <Check className="h-3 w-3" /> label match
          </span>
          {!c.resolved && <span className="text-amber-300/80">· new product</span>}
        </div>
      </div>
      <button
        disabled={!canAdd || adding}
        onClick={() => onAdd(c)}
        className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold ${
          primary ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white'
        } disabled:opacity-40`}
      >
        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : c.resolved ? 'Add' : 'Create + Add'}
      </button>
    </div>
  );
}

function SessionList({ added }: { added: AddedItem[] }) {
  return (
    <div className="mb-1 w-[min(92vw,420px)] space-y-1">
      {added.slice(0, 3).map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="truncate text-white/80">{a.title}</span>
          <span className="ml-auto text-white/30">added</span>
        </div>
      ))}
      {added.length > 0 && (
        <div className="text-center text-[11px] text-white/40">{added.length} added this session</div>
      )}
    </div>
  );
}
