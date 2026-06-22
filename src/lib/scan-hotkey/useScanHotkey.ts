'use client';

import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import {
  getHotkey,
  registerScanTarget,
  setCapturing,
  setHotkey,
  subscribe,
} from './store';

/** Live focus-scan binding + setter. Re-renders when the key changes anywhere. */
export function useScanHotkey() {
  const hotkey = useSyncExternalStore(subscribe, getHotkey, getHotkey);
  return { hotkey, setHotkey, setCapturing };
}

/**
 * Register a scan input as the hotkey's focus target while mounted. The most
 * recently mounted bar wins (the page's active scan bar), so dropping this on
 * every StationScanBar lights the shared hotkey up everywhere with no per-page
 * wiring.
 */
export function useRegisterScanTarget(
  inputRef: RefObject<HTMLInputElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    return registerScanTarget(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, [inputRef, enabled]);
}
