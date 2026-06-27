'use client';

import { useEffect } from 'react';

/**
 * Opt-in "Escape closes" behaviour. Attach to MODAL/overlay surfaces that should
 * dismiss on Escape — deliberately NOT baked into shared controllers so inline
 * (non-modal) reuses of those controllers don't inherit a global Escape handler.
 *
 * @param onEscape called when Escape is pressed while mounted + enabled
 * @param enabled  gate the listener (default true)
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, enabled]);
}
