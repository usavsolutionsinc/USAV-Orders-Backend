/**
 * Synthesized sound cues for mobile workflows.
 *
 * Sounds are generated via Web Audio API at runtime (see
 * `src/lib/feedback/confirm.ts`) — no MP3 assets, no preloading, works offline.
 *
 * Each cue is a sequence of oscillator tones. Frequencies share a common key
 * family so layered events (e.g., scan-then-confirm) sound musically related.
 *
 * Sound is OFF by default. Workers can opt in via the feedback preference
 * surface — useful at quiet stations, distracting on noisy floors.
 *
 * Pair every sound with a visual cue — never use sound alone.
 */

export interface ToneStep {
  /** Oscillator frequency in Hz. */
  freq: number;
  /** Step duration in ms. */
  durationMs: number;
  /** Linear gain 0–1. Default 0.18. */
  volume?: number;
  /** Delay before this step starts, in ms (chained from previous step end). */
  delayMs?: number;
}

/** Each cue is a tone sequence; single-tone cues use a one-element array. */
export const toneCue = {
  /** Soft high beep — accepted scan. */
  scanBeep: [{ freq: 1320, durationMs: 50, volume: 0.12 }],
  /** Single A5 — primary action accepted. */
  confirm: [{ freq: 880, durationMs: 80, volume: 0.18 }],
  /** Two-note descending — error / rejection. */
  error: [{ freq: 220, durationMs: 200, volume: 0.22 }],
  /** Two-note ascending chime — terminal success (order shipped). */
  complete: [
    { freq: 660, durationMs: 70, volume: 0.16 },
    { freq: 990, durationMs: 90, volume: 0.18, delayMs: 20 },
  ],
  /** Subtle warning tick — short-pick, mismatch warning. */
  warning: [{ freq: 440, durationMs: 90, volume: 0.16 }],
  /** Carton arrival from desktop — two-note ascending chime. */
  arrival: [
    { freq: 660, durationMs: 70, volume: 0.16 },
    { freq: 990, durationMs: 90, volume: 0.18, delayMs: 20 },
  ],
} as const satisfies Record<string, readonly ToneStep[]>;

export type ToneCueName = keyof typeof toneCue;
