import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KeyboardState {
  /** True when the mobile virtual keyboard is visible. Always false on desktop. */
  isKeyboardOpen: boolean;
  /** Estimated height of the keyboard in CSS pixels (0 when closed). */
  keyboardHeight: number;
  /** Height of the visible viewport (excludes keyboard area). */
  visibleHeight: number;
}

interface UseKeyboardOptions {
  /**
   * When true, auto-scrolls the focused input to the vertical center of the
   * visible viewport whenever the keyboard opens. Default: false.
   */
  centerOnFocus?: boolean;
  /**
   * Minimum height reduction (px) between `window.innerHeight` and
   * `visualViewport.height` to consider the keyboard open. Default: 150.
   */
  threshold?: number;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Universal mobile keyboard detection hook.
 *
 * Uses the Visual Viewport API to detect when the on-screen keyboard
 * appears / disappears. On desktop browsers (or when Visual Viewport is
 * unavailable), `isKeyboardOpen` stays `false`.
 *
 * Provides a `scrollToCenter` helper for manual centering of any element.
 */
export function useKeyboard(options: UseKeyboardOptions = {}) {
  const { centerOnFocus = false, threshold = 150 } = options;

  const [state, setState] = useState<KeyboardState>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    visibleHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  // Baseline height — captured on mount and after orientation changes.
  const baselineRef = useRef(
    typeof window !== 'undefined' ? window.innerHeight : 0,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    baselineRef.current = window.innerHeight;

    const handleResize = () => {
      const baseline = baselineRef.current;
      const visible = vv.height;
      const diff = baseline - visible;
      const isOpen = diff > threshold;

      setState({
        isKeyboardOpen: isOpen,
        keyboardHeight: isOpen ? diff : 0,
        visibleHeight: visible,
      });

      // Auto-center the focused element in the visible viewport.
      if (isOpen && centerOnFocus) {
        requestAnimationFrame(() => {
          const el = document.activeElement;
          if (!el || !(el instanceof HTMLElement)) return;

          const rect = el.getBoundingClientRect();
          const viewportTop = vv.offsetTop;
          const viewportCenter = viewportTop + visible / 2;
          const elCenter = rect.top + rect.height / 2;
          const offset = elCenter - viewportCenter;

          if (Math.abs(offset) > 10) {
            window.scrollBy({ top: offset, behavior: 'smooth' });
          }
        });
      }
    };

    vv.addEventListener('resize', handleResize);

    // Recalculate baseline after orientation change (layout needs time to settle).
    const handleOrientation = () => {
      setTimeout(() => {
        baselineRef.current = window.innerHeight;
      }, 300);
    };
    window.addEventListener('orientationchange', handleOrientation);

    return () => {
      vv.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, [centerOnFocus, threshold]);

  /**
   * Manually scroll a specific element to the vertical center of the
   * visible viewport. Works with or without the keyboard being open.
   */
  const scrollToCenter = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const rect = el.getBoundingClientRect();
    const viewportCenter = vv.offsetTop + vv.height / 2;
    const elCenter = rect.top + rect.height / 2;
    const offset = elCenter - viewportCenter;

    if (Math.abs(offset) > 10) {
      window.scrollBy({ top: offset, behavior: 'smooth' });
    }
  }, []);

  return { ...state, scrollToCenter };
}
