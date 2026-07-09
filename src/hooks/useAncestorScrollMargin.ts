'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * `useAncestorScrollMargin` — the measurement half of the "multiple virtualized
 * lists share ONE scroll region" pattern (TanStack Virtual's window-scroller,
 * generalized to a bounded ancestor).
 *
 * A stacked (1-up) {@link import('@/components/board/SwimlaneBoard').SwimlaneBoard}
 * lane body does NOT own its own scroll container — it grows to content and the
 * BOARD's single scroll region owns the wheel (so a lane never traps the scroll).
 * That means each lane's `useVirtualizer` must window against the shared board
 * scroll element, and to position its rows it needs to know how far THIS lane's
 * inner list wrapper sits below the scroll region's content top — the
 * `scrollMargin`. Rows are then laid out `translateY(item.start - scrollMargin)`
 * and the virtualizer's `scrollMargin` option is set to the same value, so its
 * visible-range math accounts for the lanes stacked above.
 *
 * The margin is **scroll-invariant** (it is `innerTop - scrollTop_origin`, not a
 * function of the live scroll offset), so re-measuring on scroll is a cheap
 * no-op unless the geometry genuinely shifted — which happens when a sibling
 * lane above grows/collapses or an async row re-measures. We therefore recompute
 * on: scroll (rAF-throttled), resize of the scroll element / this list / the
 * scroll region's content wrapper (sibling growth), and window resize.
 *
 * When `enabled` is false it returns 0 and installs no listeners — the
 * self-scrolling body path (a lane that owns its own capped scroll container, or
 * the dense table) is byte-for-byte unaffected.
 */
export function useAncestorScrollMargin({
  enabled,
  scrollParentRef,
  innerRef,
  deps = [],
}: {
  /** True only when embedded in a shared ancestor scroll region (stacked lane). */
  enabled: boolean;
  /** The shared scrolling ancestor (the board's scroll region). */
  scrollParentRef: RefObject<HTMLElement | null>;
  /** This list's inner (position:relative, height=totalSize) wrapper. */
  innerRef: RefObject<HTMLElement | null>;
  /** Re-measure when the list's own content changes (grouping/day bands). */
  deps?: unknown[];
}): number {
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setScrollMargin((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const scrollEl = scrollParentRef.current;
    const inner = innerRef.current;
    if (!scrollEl || !inner) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const next = Math.max(
        0,
        Math.round(
          inner.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop,
        ),
      );
      setScrollMargin((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    scrollEl.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scrollEl);
    ro.observe(inner);
    // A sibling lane above changing height shifts this list down; observe the
    // scroll region's content wrapper so those reflows recompute the margin too.
    const content = scrollEl.firstElementChild;
    if (content) ro.observe(content);
    window.addEventListener('resize', schedule);

    return () => {
      scrollEl.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // `deps` lets the caller re-run on its own content change (day bands); the
    // ref objects are stable identities, so spreading caller deps is intentional.
  }, [enabled, scrollParentRef, innerRef, ...deps]);

  return enabled ? scrollMargin : 0;
}
