'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sku-stock:label-recents:v1';
const MAX_RECENTS = 6;

export interface LabelRecent {
  /** The unique printed SKU (e.g. `BASE:1234`). */
  sku: string;
  /** First serial number, if any. Used for tooltip / display only. */
  sn?: string;
  /** Product title at print time, for hover context. */
  title?: string;
  /** Timestamp (ms epoch) for ordering and stale-detection. */
  at: number;
}

function readStorage(): LabelRecent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is LabelRecent =>
        r && typeof r.sku === 'string' && typeof r.at === 'number',
    );
  } catch {
    return [];
  }
}

function writeStorage(items: LabelRecent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded or storage disabled — recents are non-essential
  }
}

/**
 * Session-persistent list of the last few printed labels. Backed by
 * `localStorage` so it survives reloads but stays per-device. Used by the
 * /sku-stock workspace to render a one-tap "reprint recent" strip.
 */
export function useLabelRecents() {
  const [recents, setRecents] = useState<LabelRecent[]>([]);

  // Hydrate once on mount (avoids SSR hydration mismatch).
  useEffect(() => {
    setRecents(readStorage());
  }, []);

  const push = useCallback((entry: Omit<LabelRecent, 'at'>) => {
    const sku = String(entry.sku || '').trim();
    if (!sku) return;
    setRecents((prev) => {
      const filtered = prev.filter((r) => r.sku !== sku);
      const next: LabelRecent[] = [
        { sku, sn: entry.sn, title: entry.title, at: Date.now() },
        ...filtered,
      ].slice(0, MAX_RECENTS);
      writeStorage(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRecents([]);
    writeStorage([]);
  }, []);

  return { recents, push, clear };
}
