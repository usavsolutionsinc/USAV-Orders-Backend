'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchTestingBundle, fetchUnitChecklist } from './sku-testing-api';
import type { Bundle, UnitResult } from './sku-testing-types';

export interface UseSkuTestingData {
  bundle: Bundle | null;
  loading: boolean;
  results: Record<number, UnitResult>;
  canRecord: boolean;
  loadBundle: () => Promise<void>;
  loadResults: () => Promise<void>;
  onResultChange: (stepId: number, next: Partial<UnitResult>) => void;
}

/**
 * Loads the testing bundle (SKU catalog crosswalk + checklist + manuals) and the
 * per-unit recorded results for the active serial. Plain fetch + local state (no
 * React Query) so a window-focus refetch never clobbers an in-progress edit.
 */
export function useSkuTestingData(
  receivingLineId: number,
  sku: string,
  title: string,
  serialUnitId?: number | null,
): UseSkuTestingData {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<number, UnitResult>>({});
  const canRecord = serialUnitId != null;

  const loadBundle = useCallback(async () => {
    setBundle(await fetchTestingBundle(receivingLineId, sku, title));
  }, [receivingLineId, sku, title]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadBundle().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadBundle]);

  // Per-unit recorded results, loaded when a serial is on the active slot.
  // Extracted so the bulk "check all / clear" action can refresh after a write.
  const loadResults = useCallback(async () => {
    if (serialUnitId == null) {
      setResults({});
      return;
    }
    const map = await fetchUnitChecklist(serialUnitId);
    if (map) setResults(map);
  }, [serialUnitId]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const onResultChange = useCallback((stepId: number, next: Partial<UnitResult>) => {
    setResults((m) => ({
      ...m,
      [stepId]: { ...(m[stepId] ?? { step_id: stepId, passed: null, verified_by_name: null }), ...next },
    }));
  }, []);

  return { bundle, loading, results, canRecord, loadBundle, loadResults, onResultChange };
}
