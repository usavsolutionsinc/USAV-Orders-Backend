'use client';

/**
 * Deep-link selection for the receiving-lines table: a shared URL
 * (`/unbox?recvId=…&lineId=…`; the param is read path-agnostically so the legacy
 * `/receiving?recvId=…` still works) auto-selects the matching row once the list
 * has loaded. Keyed on `recvId:lineId` so the same link doesn't re-fire on every
 * refresh while a NEW one applied mid-session still lands. Auto-select-on-first-
 * visit is intentionally disabled (the tab shows a "scan to start" empty state);
 * the one-shot ref is still toggled so that contract is explicit. Extracted from
 * ReceivingLinesTable; behaviour is unchanged.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { dispatchSelectLine } from '@/components/station/receiving-lines-table-helpers';
import type { ReceivingLineRow } from './receiving-line-row';

interface UseReceivingDeepLinkArgs {
  isLoading: boolean;
  localRows: ReceivingLineRow[];
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>;
}

export function useReceivingDeepLink({
  isLoading,
  localRows,
  setSelectedId,
}: UseReceivingDeepLinkArgs): void {
  const searchParams = useSearchParams();

  // Last-applied `recvId:lineId` — keyed (not boolean) so the SAME deep link
  // doesn't re-fire on every row refresh, while a NEW one applied mid-session
  // still lands.
  const deepLinkAppliedRef = useRef<string | null>(null);
  const initialAutoSelectRef = useRef(false);

  useEffect(() => {
    const recvIdParam = searchParams.get('recvId');
    if (!recvIdParam || !/^\d+$/.test(recvIdParam)) return;
    if (isLoading || localRows.length === 0) return;
    const lineIdParam = searchParams.get('lineId');
    const deepLinkKey = `${recvIdParam}:${lineIdParam ?? ''}`;
    if (deepLinkAppliedRef.current === deepLinkKey) return;

    const recvId = Number(recvIdParam);
    const lineId =
      lineIdParam && /^\d+$/.test(lineIdParam) ? Number(lineIdParam) : null;

    let target =
      lineId != null
        ? localRows.find((r) => r.id === lineId && r.receiving_id === recvId) ??
          localRows.find((r) => r.id === lineId)
        : undefined;
    if (!target) {
      target = localRows.find((r) => r.receiving_id === recvId);
    }
    if (!target) return;

    deepLinkAppliedRef.current = deepLinkKey;
    initialAutoSelectRef.current = true;
    setSelectedId(target.id);
    dispatchSelectLine(target);
    window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
  }, [isLoading, localRows, searchParams, setSelectedId]);

  // Auto-select-on-first-visit is disabled: the Receiving tab shows a "scan to
  // start" empty state and History is a deliberate read-only browse. Deep links
  // via `?recvId=` still work (separate effect above).
  useEffect(() => {
    if (initialAutoSelectRef.current) return;
    initialAutoSelectRef.current = true;
  }, []);
}
