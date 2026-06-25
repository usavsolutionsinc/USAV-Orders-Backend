'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Measure a container's pixel width so an SVG chart can be drawn in real pixels
 * (crisp text + undistorted strokes) instead of a scaled `viewBox`. First paint
 * uses `fallback`; a `ResizeObserver` then keeps it in sync with the layout.
 */
export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(fallback = 720) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.width;
      if (next && next > 0) setWidth(Math.round(next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
