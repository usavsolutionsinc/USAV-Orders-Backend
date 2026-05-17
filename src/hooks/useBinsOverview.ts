'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface BinsOverviewRow {
  id: number;
  barcode: string | null;
  name: string;
  room: string | null;
  row_label: string | null;
  col_label: string | null;
  capacity: number | null;
  bin_type: string | null;
  zone_letter: string | null;
  total_qty: number;
  sku_count: number;
  fill_pct: number | null;
  last_counted: string | null;
  is_empty: boolean;
  is_stale: boolean;
  has_low_stock: boolean;
  is_over_capacity: boolean;
}

export interface BinsOverviewCounts {
  total: number;
  empty: number;
  stale: number;
  low_stock: number;
  over_capacity: number;
}

interface UseBinsOverviewArgs {
  room?: string | null;
  q?: string | null;
  /** Polling interval in ms; pass 0 to disable. Defaults to 30000. */
  pollMs?: number;
}

interface UseBinsOverviewResult {
  rows: BinsOverviewRow[];
  counts: BinsOverviewCounts;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const EMPTY_COUNTS: BinsOverviewCounts = {
  total: 0, empty: 0, stale: 0, low_stock: 0, over_capacity: 0,
};

export function useBinsOverview({
  room = null,
  q = null,
  pollMs = 30_000,
}: UseBinsOverviewArgs = {}): UseBinsOverviewResult {
  const [rows, setRows] = useState<BinsOverviewRow[]>([]);
  const [counts, setCounts] = useState<BinsOverviewCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const runIdRef = useRef(0);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (room) params.set('room', room);
    if (q) params.set('q', q);
    const qs = params.toString();
    return qs ? `/api/inventory/bins-overview?${qs}` : '/api/inventory/bins-overview';
  }, [room, q]);

  const load = useCallback(async () => {
    const id = ++runIdRef.current;
    try {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        rows?: BinsOverviewRow[];
        counts?: BinsOverviewCounts;
      };
      if (id !== runIdRef.current) return;
      setRows(data.rows ?? []);
      setCounts(data.counts ?? EMPTY_COUNTS);
      setError(null);
    } catch (e) {
      if (id !== runIdRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (id === runIdRef.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    const handle = window.setInterval(() => { void load(); }, pollMs);
    return () => window.clearInterval(handle);
  }, [load, pollMs]);

  return { rows, counts, loading, error, refetch: load };
}
