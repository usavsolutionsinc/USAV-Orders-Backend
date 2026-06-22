/**
 * Scan-focus hotkey — a tiny framework-agnostic store shared by EVERY
 * StationScanBar across the app.
 *
 * Three responsibilities:
 *   1. Hold the current binding (a function key F1–F12, default "F2").
 *      Hydrated synchronously from localStorage so the gear shows the right key
 *      with no flash; the server (staff_preferences) is the durable cross-device
 *      SoT, reconciled in the background by <ScanHotkeySync/>.
 *   2. Keep a stack of mounted scan-bar focus targets. The global key focuses
 *      the most-recently-mounted one (the page's active scan bar).
 *   3. Install ONE global keydown listener (lazily, on first subscribe) that
 *      fires the binding — independent of which page or component is mounted.
 *
 * Pure module, no React imports — consumed via useScanHotkey / useRegisterScanTarget.
 */

import { DEFAULT_FOCUS_SCAN_HOTKEY, FOCUS_SCAN_HOTKEY_RE } from '@/lib/schemas/staff-preferences';

const STORAGE_KEY = 'scan:focus-hotkey';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function readStored(): string {
  if (!isBrowser()) return DEFAULT_FOCUS_SCAN_HOTKEY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && FOCUS_SCAN_HOTKEY_RE.test(raw) ? raw : DEFAULT_FOCUS_SCAN_HOTKEY;
  } catch {
    return DEFAULT_FOCUS_SCAN_HOTKEY;
  }
}

let hotkey = readStored();
const listeners = new Set<() => void>();
const targets: Array<() => void> = [];
let persister: ((key: string) => void) | null = null;

// While a gear is in "press a key" capture mode the global listener must stand
// down so the capture handler can grab the next keystroke.
let capturing = false;

function emit(): void {
  listeners.forEach((l) => l());
}

function writeStored(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* storage blocked — store still works in-memory for the session */
  }
}

export function getHotkey(): string {
  return hotkey;
}

/** Set + persist (localStorage immediately, server via the registered persister). */
export function setHotkey(key: string): void {
  if (!FOCUS_SCAN_HOTKEY_RE.test(key) || key === hotkey) return;
  hotkey = key;
  writeStored(key);
  persister?.(key);
  emit();
}

/** Adopt a server value WITHOUT writing it back (hydration only). */
export function hydrateHotkey(key: string | null | undefined): void {
  if (!key || !FOCUS_SCAN_HOTKEY_RE.test(key) || key === hotkey) return;
  hotkey = key;
  writeStored(key);
  emit();
}

/** Register how setHotkey should persist to the server (called once by ScanHotkeySync). */
export function setHotkeyPersister(fn: ((key: string) => void) | null): void {
  persister = fn;
}

export function setCapturing(value: boolean): void {
  capturing = value;
}

/** React store subscription (useSyncExternalStore). Installs the global listener once. */
export function subscribe(listener: () => void): () => void {
  ensureGlobalListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Register a scan-bar input's focus action. The most-recently-registered target
 * is the one the hotkey focuses. Returns an unregister fn for cleanup on unmount.
 */
export function registerScanTarget(focus: () => void): () => void {
  ensureGlobalListener();
  targets.push(focus);
  return () => {
    const i = targets.lastIndexOf(focus);
    if (i >= 0) targets.splice(i, 1);
  };
}

function focusTopTarget(): void {
  targets[targets.length - 1]?.();
}

let installed = false;
function ensureGlobalListener(): void {
  if (installed || !isBrowser()) return;
  installed = true;
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (capturing) return; // capture handler owns the keystroke
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== hotkey) return;
    e.preventDefault();
    focusTopTarget();
  });
}
