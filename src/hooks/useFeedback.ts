/**
 * Unified haptic + audio feedback hook for mobile workflows.
 *
 * Pairs a haptic pattern with a synthesized tone cue for each named event.
 * Subscribes to the shared preference module in `@/lib/feedback/prefs` so a
 * single setting controls every haptic + sound surface in the app (both the
 * hook's events and the legacy `successFeedback`/`errorFeedback` primitives).
 *
 * Usage:
 *   const feedback = useFeedback();
 *   feedback('scanAccepted');
 *   feedback('error');
 *
 * To change prefs from a settings UI:
 *   import { setFeedbackPref } from '@/hooks/useFeedback';
 *   setFeedbackPref('sound', false);
 *
 * Implementation notes:
 *   - Uses `useSyncExternalStore` for SSR-safe subscription. Reads on the fire
 *     path hit a module-level cache — no JSON.parse per scan.
 *   - Cue → pattern mapping is centralized below so adding a new feedback
 *     event is one diff.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { haptic, type HapticName } from '@/design-system/tokens/haptics';
import { toneCue, type ToneCueName } from '@/design-system/tokens/sounds';
import { playToneSequence, vibrate } from '@/lib/feedback/confirm';
import {
  getFeedbackPrefs,
  getServerSnapshot,
  getSnapshot,
  setFeedbackPref,
  subscribe,
  type FeedbackPrefs,
} from '@/lib/feedback/prefs';

export type FeedbackEvent =
  | 'tap'
  | 'confirm'
  | 'success'
  | 'warning'
  | 'error'
  | 'scanAccepted'
  | 'scanRejected'
  | 'longPress'
  | 'selection'
  | 'arrival';

interface CuePair {
  haptic: HapticName | null;
  sound: ToneCueName | null;
}

const cueMap: Record<FeedbackEvent, CuePair> = {
  tap:          { haptic: 'tap',          sound: null },
  confirm:      { haptic: 'confirm',      sound: 'confirm' },
  success:      { haptic: 'success',      sound: 'complete' },
  warning:      { haptic: 'warning',      sound: 'warning' },
  error:        { haptic: 'error',        sound: 'error' },
  scanAccepted: { haptic: 'scanAccepted', sound: 'scanBeep' },
  scanRejected: { haptic: 'scanRejected', sound: 'error' },
  longPress:    { haptic: 'longPress',    sound: null },
  selection:    { haptic: 'selection',    sound: null },
  arrival:      { haptic: 'confirm',      sound: 'arrival' },
};

// Re-export the pref setter so consumers only need to know one import path.
export { setFeedbackPref };
export type { FeedbackPrefs };

/**
 * Returns a stable `feedback(event)` function plus the live prefs.
 *
 * The function is stable across renders. Prefs update reactively when other
 * tabs, settings UIs, or imperative `setFeedbackPref()` calls modify them.
 */
export function useFeedback() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const fire = useCallback((event: FeedbackEvent): void => {
    const pair = cueMap[event];
    if (!pair) return;
    const live = getFeedbackPrefs();
    if (live.haptic && pair.haptic) {
      vibrate(haptic[pair.haptic]);
    }
    if (live.sound && pair.sound) {
      playToneSequence(toneCue[pair.sound]);
    }
  }, []);

  return Object.assign(fire, { prefs, setPref: setFeedbackPref });
}
