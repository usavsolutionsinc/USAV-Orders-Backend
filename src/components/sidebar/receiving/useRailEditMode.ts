'use client';

/**
 * Rail edit-mode (the eyebrow pencil) for the triage/unbox sidebar rails.
 *
 * Flips the rails from open-on-click to checkbox multi-select (see
 * RailEditModeProvider / SidebarRailShell) so rows can be bulk DISMISSED.
 * Selection keys are the rails' row ids: positive = a receiving line,
 * negative = an unfound carton stub (TriageUnfoundList negates receiving_id).
 *
 * Phase 4 (universal-feed plan): the bulk action now writes a PER-STAFF
 * `staff_rail_exclusions` row (POST /api/receiving/rail-exclusions) instead of
 * hard-DELETE'ing the shared receiving line/carton. Dismissing hides the row
 * from THIS staffer's rail only and is reversible — the row still exists for
 * everyone else. The rail read filter anti-joins the same set so a refetch
 * keeps it hidden (no `usav-refresh-data` broadcast needed; the optimistic
 * drop + the read filter carry it).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  railBulkDismissing: boolean;
  toggleRailEditMode: () => void;
  toggleRailSelected: (id: number) => void;
  setManyRailSelected: (ids: number[], checked: boolean) => void;
  handleRailBulkDismiss: (ids: number[]) => Promise<void>;
}

export function useRailEditMode({
  isScanSurface,
  mode,
  unboxView,
  triageView,
}: UseRailEditModeArgs): RailEditModeState {
  const queryClient = useQueryClient();
  const [railEditMode, setRailEditMode] = useState(false);
  const [railSelectedIds, setRailSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [railBulkDismissing, setRailBulkDismissing] = useState(false);

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

  // The rail dismiss targets a feed_key; the two scan surfaces map 1:1.
  const feedKey = mode === 'triage' ? 'receiving_triage' : 'receiving_unbox';

  const handleRailBulkDismiss = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0 || railBulkDismissing) return;
      const label = ids.length === 1 ? 'this row' : `these ${ids.length} rows`;
      if (!window.confirm(`Dismiss ${label} from your receiving rails? This hides them for you only (across this surface's tabs) — you can restore them.`)) return;
      setRailBulkDismissing(true);
      try {
        // Rail id encoding → (entity_type, entity_id): negative = unfound carton
        // stub (-receiving_id → RECEIVING), positive = a receiving line. One
        // batched POST writes a staff_rail_exclusions row per item (idempotent).
        const items = ids.map((id) =>
          id < 0
            ? { entityType: 'RECEIVING', entityId: -id }
            : { entityType: 'RECEIVING_LINE', entityId: id },
        );
        const res = await fetch('/api/receiving/rail-exclusions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedKey, items }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) {
          toast.error(`Dismiss failed: ${body?.error || res.status}`);
        } else {
          // Optimistically drop the dismissed rows from the rail (the same
          // events the engine already listens for). The rows still exist — the
          // read filter keeps them hidden from THIS staffer on the next refetch,
          // so no global refresh is fired (which would un-hide them).
          for (const id of ids) {
            if (id < 0) window.dispatchEvent(new CustomEvent('receiving-entry-deleted', { detail: -id }));
            else window.dispatchEvent(new CustomEvent('receiving-line-deleted', { detail: { id } }));
          }
          toast.success(ids.length === 1 ? 'Row dismissed' : `${ids.length} rows dismissed`);
          // Refresh the exclusion set so the rail's read filter (which rides the
          // queryKey) picks up the new dismissals on its next refetch.
          void queryClient.invalidateQueries({ queryKey: ['rail-exclusions', feedKey] });
          // Dismiss is the edit-mode task — drop back to the normal
          // open-on-click rail instead of leaving empty checkboxes armed.
          setRailEditMode(false);
        }
        setRailSelectedIds(new Set());
      } finally {
        setRailBulkDismissing(false);
      }
    },
    [railBulkDismissing, feedKey, queryClient],
  );

  return {
    railEditMode,
    railSelectedIds,
    railSelectedIdList,
    railBulkDismissing,
    toggleRailEditMode,
    toggleRailSelected,
    setManyRailSelected,
    handleRailBulkDismiss,
  };
}
