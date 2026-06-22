'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePanelActions } from '@/hooks/usePanelActions';
import type { FnskuCatalogMeta } from '../FnskuCatalogInfoPanel';
import type { FbaBoardItem } from '../FbaBoardTable';
import type { PlanEntry, ScanLog } from './board-detail-shared';

/**
 * Owns the FBA board detail panel's data: the per-FNSKU plan entries + scan
 * logs fetch (parallel, with catalog-snapshot reset on item change), the
 * refetch-on-change handler, the audit panel actions, and the derived
 * expected/actual totals + resolved header title. Returns a controller bag
 * the thin shell renders from.
 */
export function useFbaBoardDetail({ item, onSaved }: { item: FbaBoardItem; onSaved: () => void }) {
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogSnapshot, setCatalogSnapshot] = useState<FnskuCatalogMeta | null>(null);

  useEffect(() => {
    setCatalogSnapshot(null);
  }, [item.item_id, item.fnsku]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const fnsku = encodeURIComponent(item.fnsku.trim().toUpperCase());
    try {
      const [entriesRes, logsRes] = await Promise.all([
        fetch(`/api/fba/board/${fnsku}/entries`),
        fetch(`/api/fba/logs?fnsku=${fnsku}&limit=50`),
      ]);
      const entriesData = await entriesRes.json();
      if (entriesData.success) setEntries(entriesData.entries ?? []);
      const logsData = await logsRes.json().catch(() => null);
      if (logsData?.success) setScanLogs(logsData.logs ?? []);
    } catch {
      // silently fall back to empty
    } finally {
      setLoading(false);
    }
  }, [item.fnsku]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleEntryChange = useCallback(() => {
    fetchEntries();
    onSaved();
  }, [fetchEntries, onSaved]);

  const panelActions = usePanelActions(
    { entityType: 'fba_item', entityId: item.item_id },
  );

  const totalExpected = entries.reduce((sum, e) => sum + (Number(e.expected_qty) || 0), 0);
  const totalActual = entries.reduce((sum, e) => sum + (Number(e.actual_qty) || 0), 0);

  const headerTitle =
    (catalogSnapshot?.productTitle || item.display_title || '').trim() ||
    item.fnsku ||
    (catalogSnapshot?.asin || item.asin || '').trim() ||
    'Untitled';

  return {
    entries, scanLogs, loading,
    setCatalogSnapshot,
    handleEntryChange,
    panelActions,
    totalExpected, totalActual, headerTitle,
  };
}
