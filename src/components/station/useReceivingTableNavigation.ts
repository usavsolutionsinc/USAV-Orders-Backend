'use client';

/**
 * Keyboard / sidebar navigation for the receiving-lines table:
 *   - `receiving-navigate-table` (sidebar chevrons / arrow keys) steps the LINE
 *     selection prev/next through the visible rows (single-select only).
 *   - `receiving-navigate-detail-overlay` steps by parent RECEIVING LOG, re-opening
 *     the details overlay for the next unique receiving_id.
 *   - keeps the active row scrolled into view when selection changes.
 * Extracted from ReceivingLinesTable; behaviour is unchanged.
 */

import { useEffect } from 'react';
import { receivingLineRowToDetailsSeed } from '@/lib/receiving/receiving-details-overlay';
import type { ReceivingLineRow } from './receiving-line-row';

interface UseReceivingTableNavigationArgs {
  orderedVisibleRows: ReceivingLineRow[];
  handleSelectRow: (row: ReceivingLineRow) => void;
  selectedIdRef: React.MutableRefObject<number | null>;
  selectModeRef: React.MutableRefObject<boolean>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  selectedId: number | null;
}

export function useReceivingTableNavigation({
  orderedVisibleRows,
  handleSelectRow,
  selectedIdRef,
  selectModeRef,
  scrollRef,
  selectedId,
}: UseReceivingTableNavigationArgs): void {
  // Sidebar chevrons / arrow keys → move the line selection.
  useEffect(() => {
    const handler = (event: Event) => {
      const direction = (event as CustomEvent<'prev' | 'next'>).detail;
      if (direction !== 'prev' && direction !== 'next') return;
      if (selectModeRef.current) return; // arrow-nav is for single-select only
      if (orderedVisibleRows.length === 0) return;

      const step = direction === 'prev' ? -1 : 1;
      const currentIndex = orderedVisibleRows.findIndex((row) => row.id === selectedIdRef.current);
      if (currentIndex < 0) return;

      const nextRow = orderedVisibleRows[currentIndex + step];
      if (!nextRow) return;
      handleSelectRow(nextRow);
    };
    window.addEventListener('receiving-navigate-table', handler);
    return () => window.removeEventListener('receiving-navigate-table', handler);
  }, [handleSelectRow, orderedVisibleRows, selectedIdRef, selectModeRef]);

  // Detail-overlay prev/next: step through unique `receiving_id`s in the visible
  // history list and re-open the overlay for the next one.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: 'prev' | 'next'; currentReceivingId: number }>).detail;
      if (!detail || (detail.direction !== 'prev' && detail.direction !== 'next')) return;
      if (orderedVisibleRows.length === 0) return;

      const uniqueReceivingIds: number[] = [];
      const seen = new Set<number>();
      for (const row of orderedVisibleRows) {
        const rid = Number(row.receiving_id);
        if (Number.isFinite(rid) && rid > 0 && !seen.has(rid)) {
          seen.add(rid);
          uniqueReceivingIds.push(rid);
        }
      }
      if (uniqueReceivingIds.length === 0) return;

      const step = detail.direction === 'prev' ? -1 : 1;
      const currentIndex = uniqueReceivingIds.indexOf(Number(detail.currentReceivingId));
      const nextIndex = currentIndex < 0 ? 0 : currentIndex + step;
      const nextReceivingId = uniqueReceivingIds[nextIndex];
      if (nextReceivingId == null) return;

      const seedRow = orderedVisibleRows.find(
        (row) => Number(row.receiving_id) === nextReceivingId,
      );

      window.dispatchEvent(
        new CustomEvent('receiving-open-details-overlay', {
          detail: {
            receivingId: nextReceivingId,
            seed: seedRow ? receivingLineRowToDetailsSeed(seedRow) : undefined,
          },
        }),
      );
    };
    window.addEventListener('receiving-navigate-detail-overlay', handler);
    return () => window.removeEventListener('receiving-navigate-detail-overlay', handler);
  }, [orderedVisibleRows]);

  // Keep the active row in view when selection changes from sidebar nav.
  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const rowEl = scrollRef.current.querySelector(
      `[data-line-row-id="${selectedId}"]`,
    ) as HTMLElement | null;
    rowEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId, scrollRef]);
}
