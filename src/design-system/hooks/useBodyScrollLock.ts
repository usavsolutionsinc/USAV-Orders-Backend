'use client';

import { useEffect } from 'react';

/**
 * Locks `document.body` scrolling while `active` is true, restoring the previous
 * value on cleanup. Centralizes the pattern that was hand-rolled (and sometimes
 * leaked — overwriting `overflow` without restoring it) across ~10 overlay/panel
 * components. Use in any modal, sheet, or slide-over.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
