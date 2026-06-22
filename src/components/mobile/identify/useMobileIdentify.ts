'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCamera } from '@/hooks/useCamera';
import { toast } from '@/lib/toast';
import { useLabelIdentify } from '@/components/receiving/label-identify/useLabelIdentify';
import { useLiveLabelScan } from '@/components/receiving/label-identify/useLiveLabelScan';
import type { LabelCandidate } from '@/lib/vision-identify';
import { SCAN_MODE_KEY, type AddedItem, type ScanMode } from './mobile-identify-shared';

/**
 * Owns the mobile identify-by-photo flow: rear-camera start/retry, manual capture
 * (freeze-frame → identify) vs live hands-free scan loop (consensus lock), the
 * add-line confirm path, the not-in-system Create-SKU + Flag-missing one-step
 * actions, the success-sheet re-arm cadence, and the derived overlay flags.
 * Returns a controller bag (incl. video/canvas refs) the thin shell renders from.
 */
export function useMobileIdentify() {
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

  // ─── P2-AI-01 · OCR → not-in-system one-step actions ────────────────────────
  // For an OCR read that resolved to a real product (resolved:true) the flow above
  // adds the line as before. When OCR read a label but it's NOT in the catalog yet
  // (resolved:false), the operator gets ONE-STEP choices that DON'T touch a unit
  // serial: (a) create a SKU now (existing /api/sku-catalog POST), or (b) flag it
  // as missing-in-system (the pending_skus "create in Zoho" queue).

  /** (a) Create a SKU from the OCR title, then add the line to the carton. */
  const createSkuAndAdd = useCallback(
    async (c: LabelCandidate, sku: string) => {
      const title = (c.product_title ?? c.item_name ?? c.model).trim();
      const cleanSku = sku.trim();
      if (!cleanSku) { toast.error('Enter a SKU to create.'); return; }
      setAdding(true);
      // Idempotency key keyed on (recv, sku) so a double-tap replays the create.
      const idemKey = `m-identify-create-${recvId ?? 'view'}-${cleanSku}`;
      try {
        const res = await fetch('/api/sku-catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
          body: JSON.stringify({ sku: cleanSku, productTitle: title, idempotencyKey: idemKey }),
        });
        const body = await res.json().catch(() => ({}));
        // 409 = SKU already exists; treat as "use the existing one" so the operator
        // isn't blocked — fall through to add the line with the returned/clean sku.
        const catalogId: number | null =
          body?.catalog?.id ?? body?.id ?? null;
        if (!res.ok && res.status !== 409) {
          toast.error(body?.error ?? 'Create SKU failed');
          return;
        }
        toast.success(res.status === 409 ? `SKU ${cleanSku} already existed` : `Created SKU ${cleanSku}`);
        // Then add the carton line bound to the new/existing catalog row (if any).
        if (recvId) {
          const clientEventId = `m-identify-${recvId}-${cleanSku}-${added.length}`;
          const lineRes = await fetch('/api/receiving/add-unmatched-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientEventId },
            body: JSON.stringify({
              receiving_id: recvId,
              sku_catalog_id: catalogId ?? undefined,
              sku: cleanSku,
              item_name: title,
              intake_type: 'po',
              client_event_id: clientEventId,
            }),
          });
          const lineBody = await lineRes.json().catch(() => ({}));
          if (lineRes.ok && lineBody.success) {
            const item: AddedItem = { id: clientEventId, title, lineId: lineBody.line?.id };
            setAdded((xs) => [item, ...xs]);
            setConfirmed(item);
            return;
          }
          toast.error(lineBody?.error ?? 'SKU created, but adding the line failed');
        } else {
          // View-only mode: SKU was created, surface success then re-arm.
          setConfirmed({ id: idemKey, title });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Create SKU failed');
      } finally {
        setAdding(false);
      }
    },
    [added.length, recvId],
  );

  /** (b) Flag the OCR'd item as missing-in-system (pending_skus to-do queue). */
  const flagMissing = useCallback(
    async (c: LabelCandidate) => {
      const title = (c.product_title ?? c.item_name ?? c.model).trim();
      // No SKU for an unfound item — key the queue on whatever uniquely names it
      // (the existing SKU if any, else the OCR model string).
      const flagSku = (c.sku || c.model || title).trim();
      if (!flagSku) { toast.error('Nothing to flag.'); return; }
      setAdding(true);
      try {
        const res = await fetch('/api/sku-catalog/flag-missing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: flagSku, suggestedTitle: title, source: 'scan' }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) { toast.error(body?.error ?? 'Flag failed'); return; }
        toast.success(`Flagged "${title}" as not in system`);
        setConfirmed({ id: `flag-${flagSku}`, title });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Flag failed');
      } finally {
        setAdding(false);
      }
    },
    [],
  );

  const isLive = mode === 'live';
  // Live mode runs the scan loop; manual waits for the shutter. These drive the overlays.
  const liveScanning = isLive && liveScan.phase === 'scanning';
  const manualIdle = !isLive && status === 'idle' && !frozen;
  const reading = status === 'identifying' || (isLive && liveScan.phase === 'reading');

  return {
    recvId, poRef,
    videoRef, canvasRef,
    cameraError,
    frozen, added, adding, confirmed,
    mode, isLive, switchMode,
    liveScan,
    status, candidates, rawText, error,
    capture, retake, confirm, createSkuAndAdd, flagMissing,
    liveScanning, manualIdle, reading,
  };
}

export type MobileIdentifyController = ReturnType<typeof useMobileIdentify>;
