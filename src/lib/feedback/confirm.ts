/**
 * Tactile + audio confirmation feedback for scan-driven actions.
 *
 *  successFeedback() — soft 50ms vibration + short 200Hz beep
 *  errorFeedback()   — three-pulse vibration + low 110Hz tone
 *
 * iOS Safari refuses to start an AudioContext outside a user gesture, so the
 * shared context is lazily created on first invocation. If permission is
 * denied (rare) the audio side silently no-ops; vibration is still attempted.
 *
 * Every primitive here respects the shared user preferences in
 * `./prefs` — toggling `haptic` or `sound` off mutes the corresponding
 * channel across both these primitives and the `useFeedback()` hook.
 *
 * Keep the surface small — these are called from inside button handlers
 * after a successful (or failed) network confirm.
 */

import { getFeedbackPrefs } from './prefs';
import type { ToneStep } from '@/design-system/tokens/sounds';

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

function safeVibrate(pattern: number | number[]): void {
  if (!getFeedbackPrefs().haptic) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* some browsers throw without a user gesture — ignore */
  }
}

function tone(opts: { freq: number; durationMs: number; volume?: number }): void {
  if (!getFeedbackPrefs().sound) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = opts.freq;
    osc.type = 'sine';
    const v = opts.volume ?? 0.18;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.005);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + opts.durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + opts.durationMs / 1000 + 0.02);
  } catch {
    /* AudioContext may be suspended in dev preview; ignore */
  }
}

/** Fired on a successful submit/confirm. */
export function successFeedback(): void {
  safeVibrate(50);
  tone({ freq: 880, durationMs: 80 });
}

/** Fired when a submit fails or input is invalid. */
export function errorFeedback(): void {
  safeVibrate([80, 40, 120]);
  tone({ freq: 220, durationMs: 200, volume: 0.22 });
}

/** Fired on each wedge-scanner accept — quieter than success. */
export function scanFeedback(): void {
  safeVibrate(20);
  tone({ freq: 1320, durationMs: 50, volume: 0.12 });
}

/**
 * Fired when a new carton hand-off lands on the phone from a desktop scan —
 * a two-note ascending chime with a double-pulse vibration so the tech feels
 * (and hears) the arrival even if they aren't looking at the screen.
 */
export function arrivalFeedback(): void {
  safeVibrate([45, 35, 70]);
  tone({ freq: 660, durationMs: 70, volume: 0.16 });
  // Second, brighter note offset slightly so the two beats are perceived as a chime.
  setTimeout(() => tone({ freq: 990, durationMs: 90, volume: 0.18 }), 90);
}

// ─── Generic primitives (used by useFeedback hook) ───────────────────────────

/** Play a tone sequence at the current time, respecting per-step delays. */
export function playToneSequence(sequence: readonly ToneStep[]): void {
  if (typeof window === 'undefined') return;
  let offset = 0;
  for (const step of sequence) {
    const start = offset + (step.delayMs ?? 0);
    if (start === 0) {
      tone(step);
    } else {
      setTimeout(() => tone(step), start);
    }
    offset = start + step.durationMs;
  }
}

/** Public vibrate primitive — same safety wrapper used internally. */
export function vibrate(pattern: number | readonly number[]): void {
  safeVibrate(pattern as number | number[]);
}
