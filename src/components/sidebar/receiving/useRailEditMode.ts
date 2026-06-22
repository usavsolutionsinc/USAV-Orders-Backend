'use client';

/**
 * Rail edit-mode (the eyebrow pencil) for the triage/unbox sidebar rails.
 *
 * Flips the rails from open-on-click to checkbox multi-select (see
 * RailEditModeProvider / SidebarRailShell) so junk rows can be bulk deleted.
 * Selection keys are the rails' row ids: positive = a receiving line,
 * negative = an unfound carton stub (TriageUnfoundList negates receiving_id).
 *
 * Extracted from ReceivingSidebarPanel; behaviour is unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import { onToggleAll } from '@/lib/selection/table-selection';

/** table-selection scope for the rail edit-mode bulk action bar. */
export const RAIL_EDIT_SCOPE = 'receiving-rail-edit';

interface UseRailEditModeArgs {
  /** Edit mode only applies on the scan surfaces (triage / unbox). */
  isScanSurface: boolean;
  /** Mode + sub-view keys — any swap drops the selection. */
  mode: string;
  unboxView: string;
  triageView: string;
}

export interface RailEditModeState {
  railEditMode: boolean;
  railSelectedIds: ReadonlySet<number>;
  railSelectedIdList: number[];
  railBulkDeleting: boolean;
  toggleRailEditMode: () => void;
  toggleRailSelected: (id: number) => void;
  setManyRailSelected: (ids: number[], checked: boolean) => void;
  handleRailBulkDelete: (ids: number[]) => Promise<void>;
}

export function useRailEditMode({
  isScanSurface,
  mode,
  unboxView,
  triageView,
}: UseRailEditModeArgs): RailEditModeState {
  const [railEditMode, setRailEditMode] = useState(false);
  const [railSelectedIds, setRailSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [railBulkDeleting, setRailBulkDeleting] = useState(false);

  const toggleRailEditMode = useCallback(() => setRailEditMode((v) => !v), []);

  const toggleRailSelected = useCallback((id: number) => {
    setRailSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Shift-click range select (see SidebarRailShell handleEditClick).
  const setManyRailSelected = useCallback((ids: number[], checked: boolean) => {
    setRailSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  // Any list swap (mode / sub-view pills) or an edit-mode flip drops the
  // selection — ids from the previous list must never leak into the next one.
  useEffect(() => {
    setRailSelectedIds(new Set());
  }, [mode, unboxView, triageView, railEditMode]);

  useEffect(() => {
    if (!isScanSurface) setRailEditMode(false);
  }, [isScanSurface]);

  // The action bar's "Clear" emits the shared toggle-all event for our scope.
  useEffect(
    () =>
      onToggleAll(RAIL_EDIT_SCOPE, (m) => {
        if (m === 'none') setRailSelectedIds(new Set());
      }),
    [],
  );

  const railSelectedIdList = useMemo(() => Array.from(railSelectedIds), [railSelectedIds]);

  const handleRailBulkDelete = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0 || railBulkDeleting) return;
      const label = ids.length === 1 ? 'this row' : `these ${ids.length} rows`;
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
      setRailBulkDeleting(true);
      try {
        // ONE batched request per entity kind (bulk `ids` endpoints) — firing N
        // parallel single-id deletes proved flaky: a couple of requests per
        // batch would 500 under pool contention, leaving survivors behind.
        // Negative rail ids are unfound carton stubs (-receiving_id, whole
        // carton); positive ids are receiving lines.
        const cartonIds = ids.filter((id) => id < 0).map((id) => -id);
        const lineIds = ids.filter((id) => id > 0);
        const failures: string[] = [];
        if (cartonIds.length > 0) {
          const res = await fetch(`/api/receiving-logs?ids=${cartonIds.join(',')}`, {
            method: 'DELETE',
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body?.success) failures.push(body?.error || `cartons (${res.status})`);
          else {
            // Already-gone ids are confirmed absent server-side — safe to drop
            // every requested carton from the rails, not just `body.deleted`.
            for (const recvId of cartonIds) {
              window.dispatchEvent(new CustomEvent('receiving-entry-deleted', { detail: recvId }));
            }
          }
        }
        if (lineIds.length > 0) {
          const res = await fetch(`/api/receiving-lines?ids=${lineIds.join(',')}`, {
            method: 'DELETE',
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body?.success) failures.push(body?.error || `lines (${res.status})`);
          else {
            for (const id of lineIds) {
              window.dispatchEvent(new CustomEvent('receiving-line-deleted', { detail: { id } }));
            }
          }
        }
        if (failures.length > 0) toast.error(`Delete failed: ${failures.join('; ')}`);
        else {
          toast.success(ids.length === 1 ? 'Row deleted' : `${ids.length} rows deleted`);
          // Deletion is the edit-mode task — drop back to the normal
          // open-on-click rail instead of leaving empty checkboxes armed.
          setRailEditMode(false);
        }
        setRailSelectedIds(new Set());
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      } finally {
        setRailBulkDeleting(false);
      }
    },
    [railBulkDeleting],
  );

  return {
    railEditMode,
    railSelectedIds,
    railSelectedIdList,
    railBulkDeleting,
    toggleRailEditMode,
    toggleRailSelected,
    setManyRailSelected,
    handleRailBulkDelete,
  };
}
