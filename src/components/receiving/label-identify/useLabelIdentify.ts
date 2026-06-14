'use client';

import { useCallback, useRef, useState } from 'react';
import {
  identifyLabelAndResolve,
  visionConfigured,
  type LabelCandidate,
} from '@/lib/vision-identify';

/**
 * State slice for "identify a product by photographing its label". Mirrors the
 * useLineSerials hook pattern: keep the camera → OCR → resolve flow out of the
 * big panel components.
 *
 *   idle → identifying → results (candidates[]) | error
 *
 * The browser posts the captured label frame straight to the LAN vision box
 * (full-res never touches Vercel), gets a canonical Bose model string, and the
 * server resolves it to a catalog product. The caller confirms a candidate and
 * pairs it via the existing add-unmatched-line / line-PATCH paths.
 */
export type LabelIdentifyStatus = 'idle' | 'identifying' | 'results' | 'error';

/** Result of one identify call, returned without touching React state. */
export interface LabelIdentifyOnce {
  ok: boolean;
  candidates: LabelCandidate[];
  rawText: string;
  error?: string;
  /** True when the call was aborted by the caller (live scan dropping a stale read). */
  aborted?: boolean;
}

export interface UseLabelIdentify {
  status: LabelIdentifyStatus;
  candidates: LabelCandidate[];
  rawText: string;
  error: string | null;
  /** True when a vision box is configured for this org (else the UI hides itself). */
  available: boolean;
  /** Run the full flow on a captured image blob, driving this hook's state. */
  identify: (blob: Blob) => Promise<void>;
  /**
   * Stateless single-shot: resolve a blob to candidates without mutating hook state.
   * Used by the live scan loop (which owns its own consensus/lock state) and by the
   * stateful `identify` above. Honors an AbortSignal so stale reads can be dropped.
   */
  identifyOnce: (blob: Blob, signal?: AbortSignal) => Promise<LabelIdentifyOnce>;
  /** Push an already-resolved live-scan result into this hook's terminal state. */
  applyResult: (result: LabelIdentifyOnce) => void;
  /** Back to idle, clearing results/errors. */
  reset: () => void;
}

/** Shared copy for "OCR ran but read no Bose model" (label not in frame). */
const NO_LABEL_MESSAGE =
  'No product label detected. Aim at the printed label on the bottom of the unit (or use search).';

export function useLabelIdentify(): UseLabelIdentify {
  const [status, setStatus] = useState<LabelIdentifyStatus>('idle');
  const [candidates, setCandidates] = useState<LabelCandidate[]>([]);
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Guard against overlapping captures (double-tap) — ignore a second identify
  // while one is in flight.
  const inFlight = useRef(false);

  // Stateless core: one capture → resolved candidates. No React state writes, so the
  // live scan loop can call it many times a second and decide for itself when to lock.
  const identifyOnce = useCallback(
    async (blob: Blob, signal?: AbortSignal): Promise<LabelIdentifyOnce> => {
      try {
        const res = await identifyLabelAndResolve(blob, signal);
        if (!res.ok) {
          const aborted = res.error === 'aborted' || signal?.aborted === true;
          return { ok: false, candidates: [], rawText: '', error: res.error, aborted };
        }
        return { ok: true, candidates: res.candidates, rawText: res.raw_text };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return { ok: false, candidates: [], rawText: '', aborted: true };
        }
        return {
          ok: false,
          candidates: [],
          rawText: '',
          error: e instanceof Error ? e.message : 'Identify failed.',
        };
      }
    },
    [],
  );

  // Map a resolved result onto this hook's idle→results|error state machine.
  const applyResult = useCallback((res: LabelIdentifyOnce) => {
    if (res.aborted) return; // dropped stale read — don't disturb the UI
    if (!res.ok) {
      setError(res.error ?? 'Identify failed.');
      setStatus('error');
      return;
    }
    setRawText(res.rawText);
    if (res.candidates.length === 0) {
      setError(NO_LABEL_MESSAGE);
      setStatus('error');
      return;
    }
    setCandidates(res.candidates);
    setStatus('results');
  }, []);

  const identify = useCallback(
    async (blob: Blob) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus('identifying');
      setError(null);
      setCandidates([]);
      setRawText('');
      try {
        applyResult(await identifyOnce(blob));
      } finally {
        inFlight.current = false;
      }
    },
    [applyResult, identifyOnce],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setCandidates([]);
    setRawText('');
    setError(null);
  }, []);

  return {
    status,
    candidates,
    rawText,
    error,
    available: visionConfigured(),
    identify,
    identifyOnce,
    applyResult,
    reset,
  };
}
