'use client';

import {
  useCallback,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { looksLikeFnsku, looksLikeFnskuPrefix } from '@/lib/scan-resolver';
import {
  extractFnskuCounts,
  mergeIntoPendingToday,
  type BulkScanCandidate,
  type ValidatedFnskuRow,
} from '@/lib/fba/plan-helpers';

interface FbaScanRoutingDeps {
  inputValue: string;
  setInputValue: Dispatch<SetStateAction<string>>;
  fbaScanOnly: boolean;
  fbaMode: 'plan' | 'select';
  openPlanId: number | null;
  setFbaError: Dispatch<SetStateAction<string | null>>;
  setPlanHint: Dispatch<SetStateAction<string | null>>;
  setTodayPlanQtyByFnsku: Dispatch<SetStateAction<Record<string, number>>>;
  setPendingTodayPlanRows: Dispatch<SetStateAction<BulkScanCandidate[] | null>>;
  fetchTodayQtyMap: () => Promise<Record<string, number>>;
  handleFnskuPlanFlow: (raw: string) => Promise<void>;
  handleBulkFnskuPlanFlow: (rows: BulkScanCandidate[]) => Promise<void>;
  handleFnskuSelectFlow: (raw: string) => void;
}

/**
 * Raw-scan classification + routing for the FBA station bar, split out of
 * {@link useFbaStationInput}: form-submit gating (FNSKU-only validation) and the
 * change handler's auto-submit / batch-paste detection that dispatches to the
 * plan or select flow. Owns no state — `inputValue` and every setter flow in.
 */
export function useFbaScanRouting({
  inputValue,
  setInputValue,
  fbaScanOnly,
  fbaMode,
  openPlanId,
  setFbaError,
  setPlanHint,
  setTodayPlanQtyByFnsku,
  setPendingTodayPlanRows,
  fetchTodayQtyMap,
  handleFnskuPlanFlow,
  handleBulkFnskuPlanFlow,
  handleFnskuSelectFlow,
}: FbaScanRoutingDeps) {
  const handleFormSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const raw = inputValue;
      const trimmed = raw.trim();
      if (!trimmed) return;

      if (fbaScanOnly && !looksLikeFnsku(trimmed)) {
        setFbaError(
          looksLikeFnskuPrefix(trimmed)
            ? 'Incomplete FNSKU — full X00… or B0… (10 characters).'
            : 'FNSKU only (X00…). No tracking, SKU, RS-, or serial in this field.',
        );
        return;
      }

      if (looksLikeFnsku(trimmed)) {
        setInputValue('');
        if (fbaScanOnly && fbaMode === 'select') {
          handleFnskuSelectFlow(trimmed);
        } else {
          void handleFnskuPlanFlow(raw);
        }
      }
    },
    [inputValue, handleFnskuPlanFlow, handleFnskuSelectFlow, setInputValue, fbaScanOnly, fbaMode]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!fbaScanOnly) return;
      setFbaError(null);
      setPlanHint(null);
      const counts = extractFnskuCounts(value);

      // Single FNSKU pasted (no separators) — auto-submit immediately
      if (counts.size === 1 && !/[\s,;|]/.test(value)) {
        const fnsku = Array.from(counts.keys())[0];
        if (looksLikeFnsku(fnsku) && value.trim().length >= 10) {
          setInputValue('');
          if (fbaMode === 'select') {
            handleFnskuSelectFlow(fnsku);
          } else {
            void handleFnskuPlanFlow(fnsku);
          }
          return;
        }
      }

      // Batch paste (multiple FNSKUs or separator-delimited)
      const hasBatch = counts.size > 1 || (counts.size === 1 && /[\s,;|]/.test(value));
      if (hasBatch && counts.size > 0) {
        setInputValue('');
        if (fbaMode === 'select') {
          for (const fnsku of Array.from(counts.keys())) {
            window.dispatchEvent(new CustomEvent('fba-board-select-by-fnsku', { detail: fnsku }));
          }
          return;
        }
        const rows: BulkScanCandidate[] = Array.from(counts.entries()).map(([fnsku, qty]) => ({
          fnsku,
          qty,
          found: false,
          product_title: null,
          asin: null,
          sku: null,
        }));
        if (fbaScanOnly) {
          void (async () => {
            const [map, validateJson] = await Promise.all([
              fetchTodayQtyMap(),
              fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(Array.from(counts.keys()).join(','))}&persist_missing=1`)
                .then((r) => r.json().catch(() => ({}))),
            ]);
            const enriched = rows.map((row) => {
              const match = Array.isArray(validateJson?.results)
                ? (validateJson.results as ValidatedFnskuRow[]).find((r) => r.fnsku === row.fnsku)
                : null;
              return match
                ? { ...row, found: !!match.found, product_title: match.product_title ?? null, asin: match.asin ?? row.asin, sku: match.sku ?? row.sku }
                : row;
            });
            setTodayPlanQtyByFnsku(map);
            setPendingTodayPlanRows((prev) => mergeIntoPendingToday(prev, enriched, map));
          })();
          return;
        }
        if (!openPlanId) {
          void (async () => {
            const [map, validateJson] = await Promise.all([
              fetchTodayQtyMap(),
              fetch(`/api/fba/fnskus/validate?fnskus=${encodeURIComponent(Array.from(counts.keys()).join(','))}&persist_missing=1`)
                .then((r) => r.json().catch(() => ({}))),
            ]);
            const enriched = rows.map((row) => {
              const match = Array.isArray(validateJson?.results)
                ? (validateJson.results as ValidatedFnskuRow[]).find((r) => r.fnsku === row.fnsku)
                : null;
              return match
                ? { ...row, found: !!match.found, product_title: match.product_title ?? null, asin: match.asin ?? row.asin, sku: match.sku ?? row.sku }
                : row;
            });
            setTodayPlanQtyByFnsku(map);
            setPendingTodayPlanRows((prev) => mergeIntoPendingToday(prev, enriched, map));
          })();
        } else {
          void handleBulkFnskuPlanFlow(rows);
        }
        return;
      }
    },
    [fbaScanOnly, fbaMode, openPlanId, setInputValue, handleBulkFnskuPlanFlow, handleFnskuPlanFlow, handleFnskuSelectFlow, fetchTodayQtyMap]
  );

  return { handleInputChange, handleFormSubmit };
}
