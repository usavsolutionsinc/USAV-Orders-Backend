'use client';

import { useEffect, useRef } from 'react';

/**
 * Listens globally for HID wedge / Bluetooth scanner input.
 *
 * Pro warehouse scanners (Zebra RS5100, Eyoyo ring, Tera 1D/2D) act as a
 * keyboard: they hammer characters with sub-50ms inter-key gaps and finish
 * with Enter. We accept a buffer that meets BOTH criteria:
 *  • All characters land within `maxInterKeyMs` of each other
 *  • Terminated by `Enter` (most scanners), `Tab` (some), or an idle timeout
 *
 * Skipped when:
 *  • The active element is an editable field (`input`, `textarea`,
 *    `contenteditable`). Receivers typing into a search box don't want their
 *    keystrokes hijacked.
 *  • Modifier keys are held (Cmd/Ctrl/Alt/Meta).
 *
 * Two-arg API stays simple — caller owns dispatch.
 */
export interface UseWedgeScannerOptions {
  /** Called when a complete scan buffer is committed. */
  onScan: (value: string) => void;
  /** Inter-key gap that classifies fast-typed input as a scan. Default 50ms. */
  maxInterKeyMs?: number;
  /** Buffer flush after Enter idle. Default 80ms (after last key + Enter). */
  idleFlushMs?: number;
  /** Minimum length to accept (filters accidental keystrokes). Default 3. */
  minLength?: number;
  /** Disable the listener entirely. */
  disabled?: boolean;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

export function useWedgeScanner(opts: UseWedgeScannerOptions): void {
  const {
    onScan,
    maxInterKeyMs = 50,
    idleFlushMs = 80,
    minLength = 3,
    disabled = false,
  } = opts;

  // Stable handler so we don't rebuild listeners on every render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;

    let buffer = '';
    let lastKeyAt = 0;
    let flushTimer: number | null = null;

    const commit = () => {
      const value = buffer.trim();
      buffer = '';
      if (flushTimer != null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (value.length >= minLength) {
        try {
          onScanRef.current(value);
        } catch {
          /* caller-side errors must not break the listener */
        }
      }
    };

    const reset = () => {
      buffer = '';
      lastKeyAt = 0;
      if (flushTimer != null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) {
        reset();
        return;
      }
      if (isEditable(e.target)) {
        // User is typing into a real field — let it through.
        reset();
        return;
      }

      const now = e.timeStamp || performance.now();
      const gap = lastKeyAt === 0 ? 0 : now - lastKeyAt;

      // Termination keys → commit whatever's buffered.
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.length > 0) {
          e.preventDefault();
          commit();
        }
        return;
      }

      // Printable single-char keys grow the buffer.
      if (e.key.length === 1) {
        // If the gap is too long we're probably watching a human type a
        // search query at a focused page — start a fresh buffer.
        if (gap > maxInterKeyMs && buffer.length > 0) {
          buffer = '';
        }
        buffer += e.key;
        lastKeyAt = now;

        if (flushTimer != null) window.clearTimeout(flushTimer);
        flushTimer = window.setTimeout(commit, idleFlushMs);
        return;
      }

      // Any other key (Backspace, arrows, Escape, etc.) cancels the run.
      reset();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (flushTimer != null) window.clearTimeout(flushTimer);
    };
  }, [disabled, idleFlushMs, maxInterKeyMs, minLength]);
}
