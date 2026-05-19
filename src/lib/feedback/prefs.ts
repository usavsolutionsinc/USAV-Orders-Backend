/**
 * Single source of truth for user feedback preferences.
 *
 * Both the React hook (`useFeedback`) and the imperative primitives
 * (`successFeedback`, `errorFeedback`, etc. in ./confirm.ts) read from this
 * module so a single setting controls every haptic + sound surface in the app.
 *
 * Storage shape is versioned (`usav.feedbackPrefs.v1`). To migrate the schema,
 * bump the suffix and add a one-shot reader for the old key.
 *
 * Defaults: haptic ON, sound ON — matches the pre-pref behavior of the legacy
 * primitives so existing screens keep their current feel. Users opt out of
 * either channel via `setFeedbackPref`.
 */

const PREFS_KEY = 'usav.feedbackPrefs.v1';
const PREFS_EVENT = 'usav:feedback-prefs.v1';

export interface FeedbackPrefs {
  haptic: boolean;
  sound: boolean;
}

const DEFAULT_PREFS: FeedbackPrefs = Object.freeze({ haptic: true, sound: true });

let cachedPrefs: FeedbackPrefs = DEFAULT_PREFS;
let hydrated = false;

function hydrateFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      cachedPrefs = DEFAULT_PREFS;
      return;
    }
    const parsed = JSON.parse(raw) as Partial<FeedbackPrefs>;
    cachedPrefs = {
      haptic: parsed.haptic ?? DEFAULT_PREFS.haptic,
      sound: parsed.sound ?? DEFAULT_PREFS.sound,
    };
  } catch {
    cachedPrefs = DEFAULT_PREFS;
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  hydrateFromStorage();
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== PREFS_KEY) return;
  hydrateFromStorage();
  notify();
}

function onPrefsEvent(event: CustomEvent<FeedbackPrefs>): void {
  if (event.detail) {
    cachedPrefs = { ...event.detail };
    notify();
  }
}

/** Subscribe to pref changes — wires up window listeners on first subscriber. */
export function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (listeners.size === 0) {
    window.addEventListener('storage', onStorageEvent);
    window.addEventListener(PREFS_EVENT, onPrefsEvent as EventListener);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorageEvent);
      window.removeEventListener(PREFS_EVENT, onPrefsEvent as EventListener);
    }
  };
}

/** Snapshot accessor for `useSyncExternalStore` (client). */
export function getSnapshot(): FeedbackPrefs {
  ensureHydrated();
  return cachedPrefs;
}

/** Server snapshot for SSR — returns defaults. */
export function getServerSnapshot(): FeedbackPrefs {
  return DEFAULT_PREFS;
}

/** Read current prefs synchronously. Safe outside React. */
export function getFeedbackPrefs(): FeedbackPrefs {
  ensureHydrated();
  return cachedPrefs;
}

/** Set a single preference. Persists + notifies all subscribers + tabs. */
export function setFeedbackPref<K extends keyof FeedbackPrefs>(key: K, value: FeedbackPrefs[K]): void {
  ensureHydrated();
  const next: FeedbackPrefs = { ...cachedPrefs, [key]: value };
  cachedPrefs = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* private-mode storage unavailable — keep cache only */
    }
    try {
      window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
    } catch {
      /* dispatchEvent rarely throws — silent fallback */
    }
  }
  notify();
}
