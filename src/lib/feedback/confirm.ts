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
 * Keep the surface small — these are called from inside button handlers
 * after a successful (or failed) network confirm.
 */

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
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* some browsers throw without a user gesture — ignore */
  }
}

function tone(opts: { freq: number; durationMs: number; volume?: number }): void {
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
