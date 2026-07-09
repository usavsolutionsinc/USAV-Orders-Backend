'use client';

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import { FBA_BOARD_INJECT_ITEM, FBA_SELECTION_ADJUSTED } from '@/lib/fba/events';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { useFbaBoardSelection } from '@/components/fba/hooks/useFbaBoardSelection';
import { normalizeFnsku } from '@/lib/tracking-format';

export interface FnskuSelectResult {
  fnsku: string;
  found: boolean;
  count: number;
  title?: string;
}

interface FbaSelectModeDeps {
  fbaScanOnly: boolean;
  fbaMode: 'plan' | 'select';
  setFbaError: Dispatch<SetStateAction<string | null>>;
  setPlanHint: Dispatch<SetStateAction<string | null>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The FBA "select / combine" scan concern: board-selection counts, the
 * select-mode fallback items bubbled up to the parent `FbaPairedReviewPanel`,
 * and the FNSKU→board-select flow (including the not-on-board auto-add-then-select
 * path). Split out of {@link useFbaStationInput}; shares the controller's
 * error/hint/input state through the passed setters.
 */
export function useFbaSelectMode({
  fbaScanOnly,
  fbaMode,
  setFbaError,
  setPlanHint,
  setInputValue,
  inputRef,
}: FbaSelectModeDeps) {
  const [selectResult, setSelectResult] = useState<FnskuSelectResult | null>(null);
  const [selectModeItems, setSelectModeItems] = useState<FbaBoardItem[]>([]);

  useEffect(() => {
    if (fbaMode !== 'select') {
      setSelectModeItems([]);
      setSelectResult(null);
    }
  }, [fbaMode]);

  const boardSelection = useFbaBoardSelection({ includePairedSelection: true });

  // Single state for selection counts. Board writes it, panel overwrites with adjusted qtys.
  const [selCounts, setSelCounts] = useState({ selected: 0, total: 0, selectedQty: 0, totalQty: 0 });
  useEffect(() => {
    const boardHandler = (e: Event) => {
      const c = (e as CustomEvent<typeof selCounts>).detail;
      if (c) setSelCounts(c);
    };
    const adjustedHandler = (e: Event) => {
      const a = (e as CustomEvent<{ selected: number; selectedQty: number }>).detail;
      if (a) setSelCounts((prev) => ({ ...prev, selected: a.selected, selectedQty: a.selectedQty }));
    };
    window.addEventListener('fba-board-selection-count', boardHandler);
    window.addEventListener(FBA_SELECTION_ADJUSTED, adjustedHandler);
    return () => {
      window.removeEventListener('fba-board-selection-count', boardHandler);
      window.removeEventListener(FBA_SELECTION_ADJUSTED, adjustedHandler);
    };
  }, []);

  // Bubble select-mode fallback items to parent so its FbaPairedReviewPanel sees them.
  useEffect(() => {
    if (selectModeItems.length === 0) return;
    const byId = new Map<number, FbaBoardItem>();
    for (const row of boardSelection) byId.set(row.item_id, row);
    for (const row of selectModeItems) byId.set(row.item_id, row);
    const merged = Array.from(byId.values());
    window.dispatchEvent(new CustomEvent('fba-paired-selection', { detail: merged }));
  }, [selectModeItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFnskuSelectFlow = useCallback(
    (raw: string) => {
      const fnsku = normalizeFnsku(raw);
      if (!fnsku) return;
      setFbaError(null);
      setPlanHint(null);
      setSelectResult(null);
      window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: fnsku }));
      setInputValue('');
      inputRef.current?.focus();
    },
    [setInputValue, inputRef],
  );

  const fetchSelectableBoardRows = useCallback(async (fnsku: string): Promise<FbaBoardItem[]> => {
    try {
      const res = await fetch('/api/fba/board', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const pending = Array.isArray(data?.pending) ? (data.pending as FbaBoardItem[]) : [];
      const key = normalizeFnsku(fnsku);
      if (!key) return [];
      // Match by FNSKU or ASIN — a B0 ASIN scan should find items with that ASIN.
      return pending.filter(
        (row) => normalizeFnsku(String(row.fnsku || '')) === key
          || (row.asin && normalizeFnsku(String(row.asin)) === key),
      );
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FnskuSelectResult>).detail;
      if (!detail) return;

      if (!fbaScanOnly || fbaMode !== 'select') {
        setSelectResult(detail);
        return;
      }

      if (detail.found) {
        setSelectResult(detail);
        return;
      }

      void (async () => {
        const fallbackRows = await fetchSelectableBoardRows(detail.fnsku);
        if (fallbackRows.length > 0) {
          setSelectModeItems((prev) => {
            const byId = new Map<number, FbaBoardItem>();
            for (const row of prev) byId.set(row.item_id, row);
            for (const row of fallbackRows) byId.set(row.item_id, row);
            return Array.from(byId.values());
          });
          setSelectResult({
            fnsku: detail.fnsku,
            found: true,
            count: fallbackRows.length,
            title: fallbackRows[0]?.display_title,
          });
          return;
        }

        // Not on board — auto-add 1 to today's plan, then select it.
        // Stay in select mode so the label printer flow isn't interrupted.
        try {
          const res = await fetch(fbaPaths.todayItems(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ fnsku: detail.fnsku, expected_qty: 1 }],
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.success !== false) {
            // Build a FbaBoardItem from the response and inject it directly.
            const added = data.added?.[0] || data.merged?.[0] || data.moved?.[0];
            const newItem: FbaBoardItem = {
              item_id: Number(added?.item_id ?? 0),
              fnsku: detail.fnsku,
              expected_qty: 1,
              actual_qty: 0,
              item_status: 'PLANNED',
              display_title: String(added?.display_title || detail.fnsku),
              asin: null,
              sku: null,
              item_notes: null,
              shipment_id: Number(data.shipment_id ?? 0),
              shipment_ref: String(data.shipment_ref ?? ''),
              amazon_shipment_id: null,
              due_date: new Date().toISOString().slice(0, 10),
              shipment_status: 'PLANNED',
              destination_fc: null,
              tracking_numbers: [],
              condition: null,
            };

            // Inject into board without full refresh, then immediately select.
            window.dispatchEvent(new CustomEvent(FBA_BOARD_INJECT_ITEM, { detail: newItem }));
            window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: detail.fnsku }));

            setSelectResult({ fnsku: detail.fnsku, found: true, count: 1, title: newItem.display_title });
            setPlanHint('Added to plan + selected');
          } else {
            setFbaError(data?.error || 'Could not auto-add to plan');
          }
        } catch {
          setFbaError('Network error — could not auto-add to plan');
        }
      })();
    };
    window.addEventListener('fba-board-fnsku-select-result', handler as EventListener);
    return () => window.removeEventListener('fba-board-fnsku-select-result', handler as EventListener);
  }, [fbaScanOnly, fbaMode, fetchSelectableBoardRows]);

  const selectedCount = selCounts.selected;
  const selectedQty = selCounts.selectedQty;

  return { selectedCount, selectedQty, handleFnskuSelectFlow, setSelectResult };
}
