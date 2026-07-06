'use client';

/**
 * Scan-band block component — a focus-locked scan input (trigger slot). On Enter
 * it classifies the raw value with the surface-aware `classifyUnboxScan` and
 * dispatches a typed `station:scan` CustomEvent `{ raw, type, intent }` the host
 * surface handles. Auto-clears + re-focuses after each submit (the station
 * focus-lock loop). Receives BlockProps but ignores rows (accepts: 'none').
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Barcode } from '@/components/Icons';
import type { BlockProps } from '@/lib/stations/contract';
import { classifyUnboxScan } from '@/lib/receiving/classify-unbox-scan';
import { isSurfaceKey, type SurfaceKey } from '@/lib/stations/surface-keys';

export interface StationScanEventDetail {
  raw: string;
  type: string;
  intent: string;
  surface: SurfaceKey;
}

export function ScanBandBlock({ display }: BlockProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  const surface: SurfaceKey = isSurfaceKey(display.surface as string)
    ? (display.surface as SurfaceKey)
    : 'unbox';
  const placeholder = (display.placeholder as string) || 'Scan tracking, serial, or SKU…';

  // Focus-lock: grab focus on mount; re-grab on unexpected blur (modals/tab-away
  // steal it — the classic wedge failure mode).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const { type, intent } = classifyUnboxScan(trimmed, { surface });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent<StationScanEventDetail>('station:scan', {
            detail: { raw: trimmed, type, intent, surface },
          }),
        );
      }
      setValue('');
      // Defer so React commits the cleared value before focus returns.
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [surface],
  );

  return (
    <form
      className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-card px-2.5 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/10"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <Barcode className="h-4 w-4 shrink-0 text-text-faint" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          // Re-grab focus on the next tick unless focus went to another input.
          setTimeout(() => {
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            inputRef.current?.focus();
          }, 0);
        }}
        placeholder={placeholder}
        aria-label="Station scan input"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-label font-semibold text-text-default placeholder:font-medium placeholder:text-text-faint focus:outline-none"
      />
    </form>
  );
}
