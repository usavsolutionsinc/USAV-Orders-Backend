'use client';

import { useEffect } from 'react';

/**
 * Calls `onClose` when the Escape key is pressed while `active` is true.
 * Centralizes the ~30 hand-rolled `keydown` + `e.key === 'Escape'` listeners
 * across overlay/panel components.
 */
export function useEscapeClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onClose]);
}
