'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { safeRandomUUID } from '@/lib/safe-uuid';
// Type-only import: `WipeMethod` is erased at compile time, so the server-only
// `recordDataWipe` module (which pulls in `@/lib/db`) is NEVER bundled into the
// client. This keeps the wipe-method enum a single source of truth without
// dragging DB code into the browser bundle.
import type { WipeMethod } from '@/lib/tech/recordDataWipe';

/**
 * Station controller for the Data-Wipe bench — the scan → resolve → active-card
 * → record → clear/refocus loop (mirrors `useStationTestingController`, but a
 * wipe acts on a single resolved serial_unit rather than a receiving line).
 *
 *   1. SCAN     — operator scans a device serial / printed unit label.
 *   2. RESOLVE  — `GET /api/serial-units/{scan}` (accepts serial / unit_uid and
 *                 returns the unit WITH its id) — the same resolver the testing
 *                 sidebar already uses via `fetchLineByUnitId`.
 *   3. ACTIVE   — the resolved unit replaces the previous active card; the
 *                 operator picks a wipe method.
 *   4. RECORD   — `POST /api/serial-units/{id}/data-wipe` with a per-scan
 *                 `client_event_id` (idempotent retry → no-op).
 *   5. CLEAR    — big pass/fail outcome, then auto-clear + refocus for the next
 *                 scan (ephemeral selection, never URL-addressable).
 */

export interface ResolvedWipeUnit {
  id: number;
  serialNumber: string;
  sku: string | null;
  productTitle: string | null;
  currentStatus: string | null;
  conditionGrade: string | null;
  currentLocation: string | null;
  unitUid: string | null;
}

export interface WipeOutcome {
  /** `wiped` → routed to grading; `failed` → routed to repair. */
  kind: 'wiped' | 'failed';
  method: WipeMethod;
  /** True when the POST re-hit the same client_event_id (idempotent retry). */
  idempotent: boolean;
  unit: ResolvedWipeUnit;
}

const DEFAULT_METHOD: WipeMethod = 'factory_reset';
/** How long the big outcome card lingers before the bench resets for the next scan. */
const OUTCOME_AUTO_HIDE_MS = 2600;

/**
 * Non-visual pass/fail cue for the eyes-down operator (station.md §6 — "pair the
 * visual pass/fail with an audio confirmation"). Pure WebAudio, SSR-guarded,
 * best-effort: a locked-down / autoplay-blocked browser silently no-ops.
 */
function playWipeCue(kind: 'wiped' | 'failed'): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = kind === 'wiped' ? 880 : 220;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    /* audio unavailable — visual state is the source of truth */
  }
}

export function useDataWipeController() {
  const [inputValue, setInputValue] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  /** `true`/`false` = that verdict is in flight; `null` = idle. Lets the view
   *  spin only the button that was pressed and gate re-entrant submits. */
  const [submittingVerdict, setSubmittingVerdict] = useState<boolean | null>(null);
  const [activeUnit, setActiveUnit] = useState<ResolvedWipeUnit | null>(null);
  const [wipeMethod, setWipeMethod] = useState<WipeMethod>(DEFAULT_METHOD);
  const [outcome, setOutcome] = useState<WipeOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // One idempotency key per scanned unit; the verdict POST reuses it so a
  // double-click / wedge double-fire collapses to a no-op server-side.
  const clientEventIdRef = useRef<string>('');
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSubmitting = submittingVerdict !== null;
  const isBusy = isResolving || isSubmitting;

  const focusInput = useCallback(() => {
    // One-tick defer so React commits the cleared input before focus returns.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearAutoHideTimer(), [clearAutoHideTimer]);

  // Focus-watchdog: re-grab the scan bar when the tab regains visibility —
  // modals / tab-aways steal focus, the classic wedge failure mode (station.md
  // §3). The global F2 hotkey (StationScanBar `hotkey`) covers the manual case.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') inputRef.current?.focus();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Pick an erasure method, then return focus to the scan bar so a wedge scan of
  // the next unit isn't swallowed by the just-clicked pill (focus-lock, §3).
  const selectMethod = useCallback(
    (method: WipeMethod) => {
      setWipeMethod(method);
      focusInput();
    },
    [focusInput],
  );

  const resetStation = useCallback(() => {
    clearAutoHideTimer();
    setActiveUnit(null);
    setOutcome(null);
    setErrorMessage(null);
    setWipeMethod(DEFAULT_METHOD);
    clientEventIdRef.current = '';
  }, [clearAutoHideTimer]);

  // ── 1+2. SCAN → RESOLVE ───────────────────────────────────────────────────
  const handleScan = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      const raw = inputValue.trim();
      if (!raw) return;
      if (isResolving || submittingVerdict !== null) return; // double-fire / wedge-burst guard

      clearAutoHideTimer();
      setIsResolving(true);
      setErrorMessage(null);
      setOutcome(null);
      setActiveUnit(null); // crossfade the previous card out before the new one mounts

      try {
        // The GET resolver accepts a numeric id, a device serial, OR a minted
        // unit_uid (printed-label QR) and returns the unit row incl. its id.
        const res = await fetch(`/api/serial-units/${encodeURIComponent(raw)}`);
        const data = await res.json().catch(() => null);
        const unit = data?.serial_unit;
        if (!res.ok || !data?.success || !unit?.id) {
          setErrorMessage(
            res.status === 404 || !unit
              ? `No unit found for "${raw}". Scan the device serial or its printed unit label.`
              : data?.error || `Lookup failed (${res.status}).`,
          );
          return;
        }

        setActiveUnit({
          id: Number(unit.id),
          serialNumber: String(unit.serial_number ?? raw),
          sku: unit.sku ?? null,
          productTitle: unit.product_title ?? null,
          currentStatus: unit.current_status ?? null,
          conditionGrade: unit.condition_grade ?? null,
          currentLocation: unit.current_location ?? null,
          unitUid: unit.unit_uid ?? null,
        });
        setWipeMethod(DEFAULT_METHOD);
        clientEventIdRef.current = safeRandomUUID();
      } catch {
        setErrorMessage('Network error resolving the serial. Try the scan again.');
      } finally {
        setIsResolving(false);
        setInputValue('');
        focusInput();
      }
    },
    [inputValue, isResolving, submittingVerdict, clearAutoHideTimer, focusInput],
  );

  // ── 4. RECORD the wipe verdict ────────────────────────────────────────────
  const submitWipe = useCallback(
    async (success: boolean) => {
      const unit = activeUnit;
      if (!unit || submittingVerdict !== null) return; // re-entrant guard
      setSubmittingVerdict(success);
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/serial-units/${unit.id}/data-wipe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wipe_success: success,
            wipe_method: wipeMethod,
            client_event_id: clientEventIdRef.current || safeRandomUUID(),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          // Request-level failure (network / 5xx) — keep the active card so the
          // operator can retry; this is distinct from a recorded `failed` wipe.
          setErrorMessage(data?.error || `Wipe record failed (${res.status}).`);
          return;
        }

        const kind: WipeOutcome['kind'] = success ? 'wiped' : 'failed';
        setOutcome({ kind, method: wipeMethod, idempotent: Boolean(data.idempotent), unit });
        playWipeCue(kind);
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));

        // Act-and-clear: the finished unit gets out of the way for the next scan.
        clearAutoHideTimer();
        autoHideTimerRef.current = setTimeout(() => {
          resetStation();
          inputRef.current?.focus();
        }, OUTCOME_AUTO_HIDE_MS);
      } catch {
        setErrorMessage('Network error recording the wipe. Try again.');
      } finally {
        setSubmittingVerdict(null);
        focusInput();
      }
    },
    [activeUnit, submittingVerdict, wipeMethod, clearAutoHideTimer, resetStation, focusInput],
  );

  return {
    inputValue,
    setInputValue,
    isResolving,
    submittingVerdict,
    isSubmitting,
    isBusy,
    activeUnit,
    wipeMethod,
    setWipeMethod,
    selectMethod,
    outcome,
    errorMessage,
    inputRef,
    handleScan,
    submitWipe,
    resetStation,
  };
}
