'use client';

/**
 * Sibling-line navigation for the receiving sidebar: lazily fetch the full
 * sibling-line list for the selected carton (so up/down nav + the progress pill
 * work after a row-click), derive index/progress, and move prev/next.
 *
 * Extracted from ReceivingSidebarPanel. The selection STATE stays in the panel
 * (many event handlers mutate it); this hook owns only the derived nav logic +
 * the lazy prefetch + the arrow-key bridge, taking the state and setters as
 * inputs. Behaviour is unchanged.
 */

import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface UseReceivingLineNavigationArgs {
  selectedLine: ReceivingLineRow | null;
  scanMatchedRows: ReceivingLineRow[];
  setSelectedLine: Dispatch<SetStateAction<ReceivingLineRow | null>>;
  setScanMatchedRows: Dispatch<SetStateAction<ReceivingLineRow[]>>;
  setLineAccordionBootstrap: Dispatch<SetStateAction<'default' | 'all'>>;
}

export function useReceivingLineNavigation({
  selectedLine,
  scanMatchedRows,
  setSelectedLine,
  setScanMatchedRows,
  setLineAccordionBootstrap,
}: UseReceivingLineNavigationArgs) {
  // When the user row-clicks a line in the dashboard table, scanMatchedRows
  // is empty — which would disable the up/down nav. Populate it lazily by
  // fetching all sibling lines for the same receiving_id. Skipped when
  // scanMatchedRows already contains the selected line (scan-driven entry
  // or a prior fetch).
  useEffect(() => {
    const receivingId = selectedLine?.receiving_id;
    if (!receivingId) return;
    if (scanMatchedRows.some((r) => r.id === selectedLine.id)) return;
    let cancelled = false;
    (async () => {
      try {
        // `include=serials` so the sibling rows carry serial_units — without it
        // the replacement row below has `serials: undefined`, which momentarily
        // drops the stepper's serial count to 0 and flashes the Serial dot.
        const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}&include=serials`);
        const data = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        if (rows.length > 0) {
          setScanMatchedRows(rows);
          setSelectedLine((prev) => {
            if (!prev) return prev;
            const hit = rows.find((r) => r.id === prev.id);
            if (!hit) return prev;
            // Guard: if this fetch somehow lacks serials, keep the ones the
            // previously-selected row already had so the Serial step never
            // flashes back to pending mid-swap.
            return hit.serials == null && prev.serials != null
              ? { ...hit, serials: prev.serials }
              : hit;
          });
        }
      } catch { /* silent — nav stays disabled if fetch fails */ }
    })();
    return () => { cancelled = true; };
  }, [selectedLine, scanMatchedRows, setScanMatchedRows, setSelectedLine]);

  // Navigation + progress derived from the full sibling-line list. Counter
  // sums *units* across every matched line (received vs expected) so the pill
  // mirrors the table row's quantityText (e.g. 0/5) instead of a line count
  // (0/1). A line with workflow_status=DONE is treated as fully received even
  // if quantity_received lags behind the expectation.
  const { currentIndex, canPrev, canNext, progressReceived, progressTotal } = useMemo(() => {
    if (!selectedLine || scanMatchedRows.length === 0) {
      return { currentIndex: -1, canPrev: false, canNext: false, progressReceived: 0, progressTotal: 0 };
    }
    const idx = scanMatchedRows.findIndex((r) => r.id === selectedLine.id);
    let receivedUnits = 0;
    let totalUnits = 0;
    for (const r of scanMatchedRows) {
      const expected = Math.max(0, Number(r.quantity_expected ?? 0));
      const received = Math.max(0, Number(r.quantity_received ?? 0));
      const isDone = String(r.workflow_status || '').toUpperCase() === 'DONE';
      const expectedSafe = expected > 0 ? expected : 1;
      totalUnits += expectedSafe;
      receivedUnits += isDone ? expectedSafe : Math.min(received, expectedSafe);
    }
    return {
      currentIndex: idx,
      canPrev: idx > 0,
      canNext: idx >= 0 && idx < scanMatchedRows.length - 1,
      progressReceived: receivedUnits,
      progressTotal: totalUnits,
    };
  }, [selectedLine, scanMatchedRows]);

  // Prev/next flips the local selectedLine and fires the dedicated
  // receiving-highlight-line event so the dashboard table's blue row
  // indicator follows along. We avoid dispatching receiving-select-line
  // because that handler wipes scanMatchedRows (row-click semantics) and
  // would break subsequent nav.
  const goPrevLine = useCallback(() => {
    if (currentIndex <= 0) return;
    const target = scanMatchedRows[currentIndex - 1];
    if (target) {
      setLineAccordionBootstrap('default');
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows, setLineAccordionBootstrap, setSelectedLine]);

  const goNextLine = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= scanMatchedRows.length - 1) return;
    const target = scanMatchedRows[currentIndex + 1];
    if (target) {
      setLineAccordionBootstrap('default');
      setSelectedLine(target);
      window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
    }
  }, [currentIndex, scanMatchedRows, setLineAccordionBootstrap, setSelectedLine]);

  // Arrow keys move the main table selection (same as carton header chevrons).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (!selectedLine) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent('receiving-navigate-table', {
          detail: event.key === 'ArrowUp' ? 'prev' : 'next',
        }),
      );
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLine]);

  return { currentIndex, canPrev, canNext, progressReceived, progressTotal, goPrevLine, goNextLine };
}
