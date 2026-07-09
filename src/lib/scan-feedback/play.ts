/**
 * Scan-feedback playback primitives — a short WebAudio confirmation tone and an
 * optional haptic pulse for the receiving station's act-and-clear loop.
 *
 * Framework-agnostic and gated by `useScanFeedback()` (which reads the org master
 * switch + per-staff toggles from the Settings Registry). No audio asset to ship:
 * a tiny oscillator beep keeps the bundle clean and works offline. A rising
 * two-note chirp signals success; a low double-buzz signals a reject — distinct
 * for the eyes-down operator who can't watch the screen.
 */

export type ScanFeedbackKind = 'success' | 'reject';

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    // A gesture-suspended context must be resumed before it will sound.
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, freq: number, startAt: number, durationMs: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Short attack/release envelope so the tone doesn't click.
  const t0 = ctx.currentTime + startAt;
  const dur = durationMs / 1000;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.12, t0 + 0.005);
  gain.gain.setValueAtTime(0.12, Math.max(t0 + 0.005, t0 + dur - 0.02));
  gain.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

/** Play the success/reject confirmation tone (no-op if WebAudio is unavailable). */
export function playScanTone(kind: ScanFeedbackKind): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (kind === 'success') {
    // Rising two-note chirp.
    beep(ctx, 880, 0, 70);
    beep(ctx, 1320, 0.08, 90);
  } else {
    // Low double buzz.
    beep(ctx, 220, 0, 120);
    beep(ctx, 180, 0.14, 160);
  }
}

/** Fire a best-effort haptic pulse (no-op where the Vibration API is unsupported). */
export function vibrateScan(kind: ScanFeedbackKind): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(kind === 'success' ? 16 : [24, 40, 24]);
  } catch {
    /* vibrate is best-effort; ignore unsupported hardware */
  }
}
