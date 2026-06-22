'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { fetchMissingOrders, fetchRawPreview, fetchReconcile, patchMissingStatus } from './po-mailbox-api';
import type { MissingResponse, MissingStatus, Mode, PreviewResponse, ReconcileResponse } from './po-mailbox-types';

/**
 * Controller for the PO mailbox reconciler: owns the mode, shared scan controls,
 * the three response caches (reconcile / raw preview / missing worklist), and the
 * scan/reconcile/refresh/status-update actions. A fresh reconcile also refreshes
 * the missing worklist when that tab is active.
 */
export function usePoMailbox() {
  const [mode, setMode] = useState<Mode>('missing');

  // shared scan controls (used by 'scanned' + 'raw')
  const [scanQuery, setScanQuery] = useState('is:unread');
  const [scanLimit, setScanLimit] = useState(25);
  const [scanLoading, setScanLoading] = useState(false);

  const [reconcile, setReconcile] = useState<ReconcileResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  // missing mode state
  const [missing, setMissing] = useState<MissingResponse | null>(null);
  const [missingStatusFilter, setMissingStatusFilter] = useState<MissingStatus>('pending');
  const [missingLoading, setMissingLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  // row expand toggle (shared)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchMissing = useCallback(async () => {
    setMissingLoading(true);
    try {
      setMissing(await fetchMissingOrders(missingStatusFilter));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load missing failed');
    } finally {
      setMissingLoading(false);
    }
  }, [missingStatusFilter]);

  const runReconcile = useCallback(async () => {
    setScanLoading(true);
    try {
      const data = await fetchReconcile(scanQuery, scanLimit);
      setReconcile(data);
      setExpanded({});
      const summary = `missing ${data.counts.missing} · in Zoho ${data.counts.in_zoho} · received ${data.counts.received}`;
      toast.success(`Reconciled ${data.items.length} in ${data.elapsedMs}ms — ${summary}`);
      // missing tab depends on this run for freshness
      if (mode === 'missing') void fetchMissing();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setScanLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanQuery, scanLimit, mode]);

  const runRawPreview = useCallback(async () => {
    setScanLoading(true);
    try {
      const data = await fetchRawPreview(scanQuery, scanLimit);
      setPreview(data);
      setExpanded({});
      toast.success(`Scanned ${data.count} in ${data.elapsedMs}ms`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setScanLoading(false);
    }
  }, [scanQuery, scanLimit]);

  // Initial load + refresh when filter / mode changes.
  useEffect(() => {
    if (mode === 'missing') void fetchMissing();
  }, [mode, fetchMissing]);

  const updateMissingStatus = useCallback(
    async (id: string, status: MissingStatus) => {
      setActingId(id);
      try {
        await patchMissingStatus(id, status);
        toast.success(`Marked ${status}`);
        await fetchMissing();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
      } finally {
        setActingId(null);
      }
    },
    [fetchMissing],
  );

  return {
    mode, setMode,
    scanQuery, setScanQuery,
    scanLimit, setScanLimit,
    scanLoading,
    reconcile, preview,
    missing, missingLoading,
    missingStatusFilter, setMissingStatusFilter,
    actingId,
    expanded, setExpanded,
    runReconcile, runRawPreview, fetchMissing, updateMissingStatus,
  };
}

export type PoMailboxController = ReturnType<typeof usePoMailbox>;
