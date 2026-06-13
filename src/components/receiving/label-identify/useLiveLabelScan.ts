'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  gateFrame,
  GATE_HINTS,
  DEFAULT_GATE_THRESHOLDS,
  type GateReason,
} from '@/lib/vision/frame-quality';
import type { LabelCandidate } from '@/lib/vision-identify';
import type { LabelIdentifyOnce } from './useLabelIdentify';

/**
 * Hands-free live label scanning. Drives a throttled capture loop over a <video>
 * element: each tick gates the frame on-device (stability + sharpness + brightness)
 * and only sends steady, sharp shots to the LAN vision box. Successful reads feed a
 * short consensus buffer; when the same model is read in N of the last M sends, the
 * scan LOCKS (freeze + the existing confirm sheet). The operator still taps Add — this
 * replaces the shutter, not the human-confirm step.
 *
 * Two-tier funnel (see frame-quality.ts): cheap local gate → expensive remote OCR.
 * Backpressure is strict: one request in flight at a time, latest-wins, stale reads
 * are aborted — frames are dropped, never queued.
 */

// ── Tuning knobs (one block; re-tune on the LAN against real labels) ──────────────
const SCAN_INTERVAL_MS = 280; // ≈3-4 fps gating cadence
const GATE_DIM = 160; // downscale for the cheap on-device gate
const SEND_MAX_DIM = 1600; // full-res cap for frames actually sent to the box
const SEND_JPEG_QUALITY = 0.85;
const FREEZE_JPEG_QUALITY = 0.7;
const CONSENSUS_NEEDED = 2; // identical model reads required to lock…
const CONSENSUS_WINDOW = 3; // …within the last this-many successful sends
const GATE_THRESHOLDS = DEFAULT_GATE_THRESHOLDS;

export type LiveScanPhase = 'idle' | 'scanning' | 'reading' | 'locked' | 'error';

export interface UseLiveLabelScan {
  phase: LiveScanPhase;
  /** Coaching copy for the viewfinder ("Hold steady", "Reading…", etc.). */
  hint: string;
  /** Latest gate reason — lets the UI tint the reticle. */
  gateReason: GateReason;
  /** Populated on lock. */
  candidates: LabelCandidate[];
  rawText: string;
  /** Data URL of the frame at lock time, for freeze-frame display. */
  frozen: string | null;
  error: string | null;
  /** Begin the loop (no-op if already running or disabled). */
  start: () => void;
  /** Stop the loop and abort any in-flight read. */
  stop: () => void;
  /** Stop + clear all state back to idle. */
  reset: () => void;
}

interface RingEntry {
  model: string;
  candidates: LabelCandidate[];
  rawText: string;
}

export function useLiveLabelScan(opts: {
  videoRef: React.RefObject<HTMLVideoElement>;
  identifyOnce: (blob: Blob, signal?: AbortSignal) => Promise<LabelIdentifyOnce>;
}): UseLiveLabelScan {
  const { videoRef, identifyOnce } = opts;

  const [phase, setPhase] = useState<LiveScanPhase>('idle');
  const [hint, setHint] = useState<string>('Aim at the printed label');
  const [gateReason, setGateReason] = useState<GateReason>('ok');
  const [candidates, setCandidates] = useState<LabelCandidate[]>([]);
  const [rawText, setRawText] = useState('');
  const [frozen, setFrozen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loop machinery (refs so the tick closure stays stable across renders).
  const runningRef = useRef(false);
  const inFlightRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevGrayRef = useRef<Float32Array | null>(null);
  const ringRef = useRef<RingEntry[]>([]);
  const gateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sendCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const getCanvas = (ref: React.MutableRefObject<HTMLCanvasElement | null>) => {
    if (!ref.current) ref.current = document.createElement('canvas');
    return ref.current;
  };

  // Fully tear down the loop (clear timer, abort in-flight). Pure side-effects.
  const teardown = useCallback(() => {
    runningRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
  }, []);

  const stop = useCallback(() => {
    teardown();
    setPhase((p) => (p === 'locked' || p === 'error' ? p : 'idle'));
  }, [teardown]);

  const reset = useCallback(() => {
    teardown();
    prevGrayRef.current = null;
    ringRef.current = [];
    setCandidates([]);
    setRawText('');
    setFrozen(null);
    setError(null);
    setGateReason('ok');
    setHint('Aim at the printed label');
    setPhase('idle');
  }, [teardown]);

  // Capture the current video frame as a JPEG blob, downscaled to SEND_MAX_DIM.
  const captureSendBlob = useCallback(
    (video: HTMLVideoElement): Promise<Blob | null> => {
      const canvas = getCanvas(sendCanvasRef);
      const scale = Math.min(1, SEND_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return Promise.resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise((res) => canvas.toBlob(res, 'image/jpeg', SEND_JPEG_QUALITY));
    },
    [],
  );

  // One loop tick: gate locally, and on a passing frame send it (respecting backpressure).
  const tick = useCallback(async () => {
    if (!runningRef.current || inFlightRef.current) return;
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    // 1) Cheap on-device gate on a tiny downscale.
    const gc = getCanvas(gateCanvasRef);
    const gh = Math.max(1, Math.round((GATE_DIM * video.videoHeight) / video.videoWidth));
    gc.width = GATE_DIM;
    gc.height = gh;
    const gctx = gc.getContext('2d', { willReadFrequently: true });
    if (!gctx) return;
    gctx.drawImage(video, 0, 0, GATE_DIM, gh);
    const imageData = gctx.getImageData(0, 0, GATE_DIM, gh);
    const gate = gateFrame(imageData, prevGrayRef.current, GATE_THRESHOLDS);
    prevGrayRef.current = gate.gray;

    setGateReason(gate.reason);
    if (!gate.ok) {
      setPhase('scanning');
      setHint(GATE_HINTS[gate.reason]);
      return;
    }

    // 2) Passed the gate → send exactly one frame (latest-wins backpressure).
    let blob: Blob | null;
    try {
      blob = await captureSendBlob(video);
    } catch {
      return;
    }
    if (!blob || !runningRef.current || inFlightRef.current) return;

    inFlightRef.current = true;
    setPhase('reading');
    setHint('Reading label…');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await identifyOnce(blob, ac.signal);
      if (!runningRef.current || res.aborted) return; // dropped stale read

      if (!res.ok) {
        // A real failure (box unreachable, etc.) — pause the loop and surface it,
        // rather than hammering the box every tick.
        teardown();
        setError(res.error ?? 'Identify failed.');
        setPhase('error');
        return;
      }

      if (res.candidates.length === 0) {
        // OCR ran but read no model (label not in frame yet) — keep scanning.
        setPhase('scanning');
        setHint('Hold the label in frame');
        return;
      }

      // 3) Consensus: push the read, lock when the latest model dominates the window.
      const top = res.candidates[0];
      const ring = ringRef.current;
      ring.push({ model: top.model, candidates: res.candidates, rawText: res.rawText });
      if (ring.length > CONSENSUS_WINDOW) ring.shift();
      const agree = ring.filter((e) => e.model === top.model).length;

      if (agree >= CONSENSUS_NEEDED) {
        // Lock: freeze the frame, surface candidates, stop the loop.
        const fc = getCanvas(sendCanvasRef); // reuse the last send canvas
        const dataUrl = fc.toDataURL('image/jpeg', FREEZE_JPEG_QUALITY);
        teardown();
        setFrozen(dataUrl);
        setCandidates(res.candidates);
        setRawText(res.rawText);
        setPhase('locked');
        setHint('');
      } else {
        setPhase('scanning');
        setHint('Confirming…');
      }
    } finally {
      inFlightRef.current = false;
      abortRef.current = null;
    }
  }, [videoRef, identifyOnce, captureSendBlob, teardown]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    prevGrayRef.current = null;
    ringRef.current = [];
    setError(null);
    setFrozen(null);
    setCandidates([]);
    setPhase('scanning');
    setHint('Aim at the printed label');
    intervalRef.current = setInterval(() => void tick(), SCAN_INTERVAL_MS);
  }, [tick]);

  // Pause when the tab is hidden (battery/heat); auto-resume when it returns if we
  // were mid-scan. Locked/error states are left alone — only an active scan resumes.
  const pausedByHiddenRef = useRef(false);
  useEffect(() => {
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (runningRef.current) {
          teardown();
          pausedByHiddenRef.current = true;
          setPhase('idle');
          setHint('Paused');
        }
      } else if (pausedByHiddenRef.current) {
        pausedByHiddenRef.current = false;
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [teardown, start]);

  // Clean teardown on unmount.
  useEffect(() => () => teardown(), [teardown]);

  return {
    phase,
    hint,
    gateReason,
    candidates,
    rawText,
    frozen,
    error,
    start,
    stop,
    reset,
  };
}
