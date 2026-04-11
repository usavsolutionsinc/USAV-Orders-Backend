'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScanType } from '@/lib/barcode-routing';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecentScanEntry {
  /** Raw scanned value (SKU string or bin barcode). */
  value: string;
  /** Scan classification at the time of the scan. */
  type: ScanType;
  /** Optional human-friendly label (product title, bin address, etc.). */
  label?: string;
  /** Optional secondary line (qty, location, etc.). */
  subLabel?: string;
  /** Epoch ms when the scan was recorded. */
  timestamp: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'usav:mobile-recent-scans';
const MAX_ITEMS = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

function readStorage(): RecentScanEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentScanEntry =>
        entry &&
        typeof entry.value === 'string' &&
        (entry.type === 'sku' || entry.type === 'bin') &&
        typeof entry.timestamp === 'number',
    );
  } catch {
    return [];
  }
}

function writeStorage(entries: RecentScanEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota or private mode — ignore */
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface UseRecentScansResult {
  recentScans: RecentScanEntry[];
  /** Add a new scan to the top; dedupes on (type, value) and caps at MAX_ITEMS. */
  addScan: (entry: Omit<RecentScanEntry, 'timestamp'>) => void;
  /** Remove a specific entry. */
  removeScan: (value: string, type: ScanType) => void;
  /** Clear the entire list. */
  clearScans: () => void;
}

export function useRecentScans(): UseRecentScansResult {
  const [recentScans, setRecentScans] = useState<RecentScanEntry[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setRecentScans(readStorage());
  }, []);

  const addScan = useCallback((entry: Omit<RecentScanEntry, 'timestamp'>) => {
    setRecentScans((prev) => {
      const filtered = prev.filter(
        (e) => !(e.value === entry.value && e.type === entry.type),
      );
      const next = [{ ...entry, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      writeStorage(next);
      return next;
    });
  }, []);

  const removeScan = useCallback((value: string, type: ScanType) => {
    setRecentScans((prev) => {
      const next = prev.filter((e) => !(e.value === value && e.type === type));
      writeStorage(next);
      return next;
    });
  }, []);

  const clearScans = useCallback(() => {
    setRecentScans([]);
    writeStorage([]);
  }, []);

  return { recentScans, addScan, removeScan, clearScans };
}
