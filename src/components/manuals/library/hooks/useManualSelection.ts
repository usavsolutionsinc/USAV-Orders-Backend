'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { dispatchManualsUpdated } from '../../ManualCrudModals';
import { bulkDeleteManuals, bulkMoveManuals, restoreManuals } from '../manuals-library-api';

export interface UseManualSelection {
  selection: Set<number>;
  toggleSelected: (id: number, additive: boolean) => void;
  clearSelection: () => void;
  bulkBusy: boolean;
  moveOpen: boolean;
  setMoveOpen: React.Dispatch<React.SetStateAction<boolean>>;
  moveTarget: string;
  setMoveTarget: React.Dispatch<React.SetStateAction<string>>;
  runBulkMove: () => Promise<void>;
  runBulkDelete: () => Promise<void>;
}

/**
 * Owns the bulk-select state and the move/delete operations. The selection is
 * dropped whenever the underlying list refetches (`reloadToken`) since the ids
 * may no longer exist. Delete shows a 10s toast with an Undo that restores the
 * soft-deleted rows.
 *
 * @param reloadToken Bumped by the data hook on every refetch.
 */
export function useManualSelection(reloadToken: number): UseManualSelection {
  const [selection, setSelection] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');

  // Drop selection whenever the manuals list refetches.
  useEffect(() => {
    setSelection(new Set());
  }, [reloadToken]);

  const toggleSelected = useCallback((id: number, additive: boolean) => {
    setSelection((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const runBulkMove = useCallback(async () => {
    if (selection.size === 0) return;
    const ids = Array.from(selection);
    setBulkBusy(true);
    try {
      const { updated } = await bulkMoveManuals(ids, moveTarget);
      dispatchManualsUpdated();
      toast.success(`Moved ${updated} ${updated === 1 ? 'manual' : 'manuals'} to ${moveTarget || 'root'}`);
      setMoveOpen(false);
      setMoveTarget('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk move failed');
    } finally {
      setBulkBusy(false);
    }
  }, [selection, moveTarget]);

  const runBulkDelete = useCallback(async () => {
    if (selection.size === 0) return;
    const ids = Array.from(selection);
    setBulkBusy(true);
    try {
      const { updated: count } = await bulkDeleteManuals(ids);
      dispatchManualsUpdated();
      toast.success(`Deleted ${count} ${count === 1 ? 'manual' : 'manuals'}`, {
        duration: 10_000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await restoreManuals(ids);
              dispatchManualsUpdated();
              toast.success(`Restored ${ids.length} ${ids.length === 1 ? 'manual' : 'manuals'}`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Restore failed');
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkBusy(false);
    }
  }, [selection]);

  return {
    selection,
    toggleSelected,
    clearSelection,
    bulkBusy,
    moveOpen,
    setMoveOpen,
    moveTarget,
    setMoveTarget,
    runBulkMove,
    runBulkDelete,
  };
}
