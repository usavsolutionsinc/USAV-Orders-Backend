'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { dispatchReceivingCartonUnlinkPatch } from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';

export interface ReceivingCartonUnlinkOptions {
  receivingId: number;
  /** Workspace row id — may be negative for lineless carton stubs. */
  lineId?: number;
  /** After server success — e.g. clear local lines, close error banner. */
  onSuccess?: () => void;
  confirmMessage?: string;
}

/**
 * Operator unpair of a sales-order / PO pairing — clears carton + line linkage
 * via POST /api/receiving/:id/unpair and patches every open surface by
 * receiving_id (not only positive line ids).
 */
export function useReceivingCartonUnlink() {
  const queryClient = useQueryClient();
  const [unlinking, setUnlinking] = useState(false);

  const unlinkCarton = useCallback(
    async ({
      receivingId,
      lineId,
      onSuccess,
      confirmMessage = 'Unlink this package? The order/PO pairing is cleared and the carton goes back to the Unfound queue.',
    }: ReceivingCartonUnlinkOptions) => {
      if (unlinking) return false;
      if (!window.confirm(confirmMessage)) return false;

      setUnlinking(true);
      try {
        const res = await fetch(`/api/receiving/${receivingId}/unpair`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          toast.error(data?.error ?? `Unlink failed (${res.status})`);
          return false;
        }

        dispatchReceivingCartonUnlinkPatch(receivingId, lineId);
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        invalidateReceivingFeeds(queryClient);
        onSuccess?.();
        toast.success('Unlinked — back on the Unfound queue');
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Unlink failed');
        return false;
      } finally {
        setUnlinking(false);
      }
    },
    [queryClient, unlinking],
  );

  return { unlinkCarton, unlinking };
}
