import { useState, useEffect, useCallback, useRef } from 'react';

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
