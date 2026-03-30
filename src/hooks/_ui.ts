import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/** Mobile breakpoint – matches Tailwind's `md` (768px). */
export const MOBILE_BREAKPOINT = '(max-width: 767px)';

/** True on phones / narrow viewports (< 768px). SSR-safe. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_BREAKPOINT);
}

// ─── Device detection ────────────────────────────────────────────────────────

export interface DeviceInfo {
  /** True if the hardware is a phone/tablet (UA Client Hints → UA string fallback). */
  isMobileDevice: boolean;
  /** True if the viewport is currently narrow (< 768px). */
  isNarrowViewport: boolean;
  /** True if the primary input is touch (no hover). */
  isTouchPrimary: boolean;
  /** True if the device has a camera (async — false until checked). */
  hasCamera: boolean;
  /**
   * The resolved mode. Uses the manual override from localStorage when set,
   * otherwise falls back to auto-detection (device + viewport + touch).
   *
   * `'mobile'` → render mobile UX (bottom bars, camera flows, larger targets)
   * `'desktop'` → render desktop UX (sidebars, tables, keyboard-first)
   */
  mode: 'mobile' | 'desktop';
  /** Set a manual override that persists across sessions, or `null` to return to auto. */
  setModeOverride: (override: 'mobile' | 'desktop' | null) => void;
  /** The current manual override value (`null` = auto). */
  modeOverride: 'mobile' | 'desktop' | null;
}

const OVERRIDE_KEY = 'usav-device-mode';

/** Detect actual mobile hardware via Client Hints API → UA string fallback. */
function detectMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  // Modern: User-Agent Client Hints (Chrome, Edge, Opera — 2026 standard)
  const uaData = (navigator as any).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  // Fallback: classic UA string sniff for Safari / Firefox
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

/** Check whether a camera exists on this device. */
async function detectCamera(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/**
 * Layered device detection hook.
 *
 * Priority: manual override (localStorage) → device detection → viewport + touch.
 *
 * Use `mode` to branch between mobile/desktop UX.
 * Use `hasCamera` to gate camera-dependent flows (packer photos).
 * Use `setModeOverride('desktop')` to let users force desktop mode on a tablet, etc.
 */
export function useDeviceMode(): DeviceInfo {
  const isNarrowViewport = useMediaQuery(MOBILE_BREAKPOINT);
  const isTouchPrimary = useMediaQuery('(hover: none) and (pointer: coarse)');

  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);

  // Manual override persisted in localStorage
  const [modeOverride, setModeOverride] = useState<'mobile' | 'desktop' | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored === 'mobile' || stored === 'desktop') return stored;
    return null;
  });

  // Detect device type + camera on mount (client-only)
  useEffect(() => {
    setIsMobileDevice(detectMobileDevice());
    detectCamera().then(setHasCamera);
  }, []);

  const setOverride = useCallback((next: 'mobile' | 'desktop' | null) => {
    setModeOverride(next);
    if (typeof window !== 'undefined') {
      if (next) localStorage.setItem(OVERRIDE_KEY, next);
      else localStorage.removeItem(OVERRIDE_KEY);
    }
  }, []);

  // Auto mode: mobile if device reports mobile OR viewport is narrow + touch
  const autoMode: 'mobile' | 'desktop' =
    isMobileDevice || (isNarrowViewport && isTouchPrimary) ? 'mobile' : 'desktop';

  const mode = modeOverride ?? autoMode;

  return {
    isMobileDevice,
    isNarrowViewport,
    isTouchPrimary,
    hasCamera,
    mode,
    setModeOverride: setOverride,
    modeOverride,
  };
}

/**
 * Tracks the current window scroll position.
 */
export function useScrollPosition(): { x: number; y: number } {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handler = () => setPos({ x: window.scrollX, y: window.scrollY });
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);
  return pos;
}

/**
 * Returns current window dimensions, updated on resize.
 */
export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  });
  useEffect(() => {
    const handler = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, []);
  return size;
}

/**
 * Simple boolean toggle with optional initial state.
 * Returns [isOn, toggle, setDirectly]
 */
export function useToggle(
  initial = false,
): [boolean, () => void, React.Dispatch<React.SetStateAction<boolean>>] {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle, setOn];
}

/**
 * Tracks whether a ref'd element is visible in the viewport.
 * Returns [ref, isInView]
 */
export function useInView(
  options?: IntersectionObserverInit,
): [React.RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      options,
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, inView];
}

/**
 * Detects clicks outside a ref'd element and calls `handler`.
 * Returns a ref to attach to the element.
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [handler]);
  return ref;
}

/**
 * Returns true when the media query matches.
 * @example const isMobile = useMediaQuery('(max-width: 768px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/**
 * Copies text to the clipboard and returns whether it succeeded.
 */
export function useCopyToClipboard(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);
  return [copied, copy];
}

/**
 * Tracks the value of an input element as the user types.
 */
export function useInputValue(
  initial = '',
): [string, (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void, () => void] {
  const [value, setValue] = useState(initial);
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    [],
  );
  const reset = useCallback(() => setValue(initial), [initial]);
  return [value, onChange, reset];
}
