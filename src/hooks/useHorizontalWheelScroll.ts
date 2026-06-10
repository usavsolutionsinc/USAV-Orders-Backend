'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Translates the mouse wheel's vertical delta into horizontal scroll on the
 * target element — the convention chip strips / breadcrumb rails / tab
 * scrollers use across modern desktop apps (Linear, Stripe, Notion, etc.).
 *
 * - Skips trackpad gestures that already carry horizontal intent (deltaX > deltaY).
 * - Skips when there's nothing to scroll (no overflow).
 * - Uses passive: false so we can preventDefault and stop the parent page from
 *   scrolling vertically while the user is wheeling horizontally over the rail.
 *
 * `reattachKey`: pass any value that changes when the scroller element is
 * conditionally re-mounted (e.g. a collapsible row's expanded state) so the
 * listener re-binds to the new element; refs alone don't re-trigger effects.
 */
export function useHorizontalWheelScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  reattachKey?: unknown,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      // Trackpad already gave us a horizontal delta — let the native behavior run.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      // Nothing to scroll horizontally.
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [ref, reattachKey]);
}
