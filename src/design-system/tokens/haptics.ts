/**
 * Haptic feedback patterns for mobile workflows.
 *
 * Each pattern is either a single number (ms) or an array (vibrate-pause-vibrate
 * pattern in ms) suitable for `navigator.vibrate()`.
 *
 * Patterns are tuned to be distinguishable under glove pressure and ambient
 * warehouse noise. Pair every haptic with a visual cue — never use haptic alone.
 *
 * Used via the `useFeedback()` hook, which respects the user's haptic preference
 * and `prefers-reduced-motion`.
 */

export type HapticPattern = number | readonly number[];

export const haptic = {
  /** Light tap — every tappable button. */
  tap: 10,
  /** Confirm — primary action accepted. */
  confirm: [15, 30, 15],
  /** Success — terminal positive event (order shipped, pick complete). */
  success: [10, 40, 80],
  /** Warning — soft attention needed (short-pick, mismatch ahead). */
  warning: [50, 80, 50],
  /** Error — action rejected. Distinctly long + multi-pulse. */
  error: [80, 60, 80, 60, 120],
  /** Scan accepted — match in scanner. Short and crisp. */
  scanAccepted: 20,
  /** Scan rejected — wrong barcode / not found. */
  scanRejected: [40, 40, 40],
  /** Long-press recognized. */
  longPress: 30,
  /** Selection changed (carousel, pill rail). */
  selection: 6,
} as const;

export type HapticName = keyof typeof haptic;
