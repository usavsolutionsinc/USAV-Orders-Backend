'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WorkOrderRow } from '@/components/work-orders/types';

/**
 * Loads work-order assignments whose deadline falls within [from, to) from the
 * windowed calendar endpoint (GET /api/work-orders/calendar). Returns the raw
 * rows; day-bucketing is the grid's concern. Refetch is exposed so an assign
 * action can pull fresh data after a PATCH.
 */
export function useCalendarWorkOrders(from: Date, to: Date) {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: fromISO, to: toISO });
      const res = await fetch(`/api/work-orders/calendar?${params.toString()}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.details || payload?.error || 'Failed to load calendar'));
      }
      const data = await res.json();
      setRows(Array.isArray(data?.rows) ? (data.rows as WorkOrderRow[]) : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load calendar');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromISO, toISO]);

  useEffect(() => {
    void load();
  }, [load]);

  // A successful assign dispatches this event (saveWorkOrder fires it) — keep
  // the calendar in sync with the queue without a manual refresh.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener('usav-refresh-data', handler);
    return () => window.removeEventListener('usav-refresh-data', handler);
  }, [load]);

  return { rows, loading, error, refetch: load };
}
