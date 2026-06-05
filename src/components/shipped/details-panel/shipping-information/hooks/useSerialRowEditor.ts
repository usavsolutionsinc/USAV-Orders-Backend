import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseSerialRows, patchSerialNumberInData } from '../../serial-helpers';

export type SerialSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface UseSerialRowEditorArgs {
  rowId: number;
  trackingNumber: string | null | undefined;
  serialNumber: string | null | undefined;
  techId?: number | null;
  fnskuLogId?: number | null;
  salId?: number | null;
  onUpdate?: () => void;
}

/**
 * Owns all editing state, refs, debounced autosave, SKU-colon expansion and
 * optimistic cache patching for a single serial-number row. The view consumes
 * the returned handlers and stays presentational.
 */
export function useSerialRowEditor({
  rowId,
  trackingNumber,
  serialNumber,
  techId,
  fnskuLogId,
  salId,
  onUpdate,
}: UseSerialRowEditorArgs) {
  const queryClient = useQueryClient();
  const [serialRows, setSerialRows] = useState<string[]>(() => parseSerialRows(serialNumber));
  const serialRowsRef = useRef<string[]>(parseSerialRows(serialNumber));
  const [isEditing, setIsEditing] = useState(false);
  // Mirror isEditing into a ref so effects that must not re-run on every edit
  // can still read the current value without adding isEditing to their deps.
  const isEditingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SerialSaveState>('idle');
  const saveTimerRef = useRef<number | null>(null);
  const skuColonLookupTimerRef = useRef<number | null>(null);
  const skuColonLookupSeqRef = useRef(0);
  const lastSavedSerialNumberRef = useRef(
    parseSerialRows(serialNumber)
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean)
      .join(', ')
  );

  // Keep the ref in sync with state so other effects can read it.
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  useEffect(() => {
    const incoming = parseSerialRows(serialNumber)
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean)
      .join(', ');

    // If the user is actively editing, don't blow away their unsaved changes.
    // Just update the "last saved" baseline so the comparison stays accurate.
    if (isEditingRef.current) {
      lastSavedSerialNumberRef.current = incoming;
      return;
    }

    const parsedRows = parseSerialRows(serialNumber);
    setSerialRows(parsedRows);
    serialRowsRef.current = parsedRows;
    setIsEditing(false);
    setError(null);
    setSaveState('idle');
    lastSavedSerialNumberRef.current = incoming;
  }, [rowId, serialNumber]);

  useEffect(() => {
    if (saveState === 'idle' || saveState === 'saving') return;
    const timeout = window.setTimeout(() => setSaveState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (skuColonLookupTimerRef.current) {
        window.clearTimeout(skuColonLookupTimerRef.current);
      }
    };
  }, []);

  const scheduleSkuColonExpand = useCallback((rowIndex: number, rawValue: string) => {
    const trimmed = rawValue.trim().toUpperCase();
    if (!trimmed.includes(':')) return;
    const left = trimmed.split(':')[0]?.trim() ?? '';
    if (!left) return;

    if (skuColonLookupTimerRef.current) {
      window.clearTimeout(skuColonLookupTimerRef.current);
      skuColonLookupTimerRef.current = null;
    }

    const seq = ++skuColonLookupSeqRef.current;
    skuColonLookupTimerRef.current = window.setTimeout(async () => {
      skuColonLookupTimerRef.current = null;
      if (seq !== skuColonLookupSeqRef.current) return;

      try {
        const res = await fetch(`/api/sku/serials-from-code?code=${encodeURIComponent(trimmed)}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          setError(String(data?.error || 'SKU lookup failed'));
          setSaveState('error');
          return;
        }
        const serials = Array.isArray(data.serials)
          ? data.serials.map((s: unknown) => String(s || '').trim().toUpperCase()).filter(Boolean)
          : [];
        if (serials.length === 0) {
          setError('No serials on file for this SKU.');
          setSaveState('error');
          return;
        }
        if (seq !== skuColonLookupSeqRef.current) return;

        if (data.notes) {
          window.alert(`Notes for SKU:\n\n${data.notes}`);
        }

        setSerialRows((current) => {
          const next = [...current];
          next.splice(rowIndex, 1, ...serials);
          serialRowsRef.current = next.length > 0 ? next : [''];
          return next.length > 0 ? next : [''];
        });
        setError(null);
        setSaveState('idle');
      } catch {
        setError('Network error loading SKU serials');
        setSaveState('error');
      }
    }, 400);
  }, []);

  const normalizedRows = serialRows
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
  const normalizedSerialNumber = normalizedRows.join(', ');

  const saveSerialRows = useCallback(async (rowsToSave: string[]): Promise<boolean> => {
    if (!trackingNumber && !fnskuLogId && !salId) {
      setError('Tracking number or scan session is required to update serials.');
      setSaveState('error');
      return false;
    }

    const nextSerialNumber = rowsToSave.join(', ');
    const snapshots: Array<{ key: readonly unknown[]; data: any }> = [];

    [['orders'], ['shipped'], ['dashboard-table']].forEach((key) => {
      const matches = queryClient.getQueriesData({ queryKey: key });
      matches.forEach(([queryKey, data]) => {
        snapshots.push({ key: queryKey, data });
        queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, nextSerialNumber));
      });
    });

    setError(null);
    setSaveState('saving');

    try {
      // Prefer new SAL-based API when salId is available
      const response = salId
        ? await fetch('/api/tech/serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              salId,
              serials: rowsToSave,
              techId: techId ?? null,
            }),
          })
        : await fetch('/api/tech/update-serials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracking: trackingNumber || null,
              serialNumbers: rowsToSave,
              techId: techId ?? null,
              fnskuLogId: fnskuLogId ?? null,
            }),
          });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.details || data?.error || 'Failed to update serials');
      }

      const savedSerials = Array.isArray(data.serialNumbers)
        ? data.serialNumbers.map((row: unknown) => String(row || '').trim().toUpperCase()).filter(Boolean)
        : rowsToSave;
      const savedSerialNumber = savedSerials.join(', ');

      setSerialRows(savedSerials.length > 0 ? savedSerials : ['']);
      serialRowsRef.current = savedSerials.length > 0 ? savedSerials : [''];
      lastSavedSerialNumberRef.current = savedSerialNumber;
      setSaveState('saved');
      [['orders'], ['shipped'], ['dashboard-table']].forEach((key) => {
        const matches = queryClient.getQueriesData({ queryKey: key });
        matches.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, savedSerialNumber));
        });
      });
      // tech-logs rows use SAL/TSN ids (not order id) so surgical patch by
      // rowId won't hit them — invalidate to force a fresh fetch instead.
      queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
      onUpdate?.();
      return true;
    } catch (saveError) {
      snapshots.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
      setSaveState('error');
      setError(saveError instanceof Error ? saveError.message : 'Failed to update serials');
      return false;
    }
  }, [fnskuLogId, onUpdate, queryClient, rowId, salId, techId, trackingNumber]);

  useEffect(() => {
    if (!isEditing) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (normalizedSerialNumber === lastSavedSerialNumberRef.current) return;

    // Read from the ref inside the callback so we always save the latest value
    // even if more renders happen before the 700 ms window closes.
    saveTimerRef.current = window.setTimeout(() => {
      const latestRows = serialRowsRef.current
        .map((row) => row.trim().toUpperCase())
        .filter(Boolean);
      void saveSerialRows(latestRows);
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
    // normalizedRows intentionally omitted: it's a new array reference every render
    // and would continuously reset the timer. normalizedSerialNumber (string) is
    // the stable signal; serialRowsRef.current is read inside the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, normalizedSerialNumber, trackingNumber]);

  const addRow = useCallback(() => {
    setSerialRows((current) => [...current, '']);
    serialRowsRef.current = [...serialRowsRef.current, ''];
    setError(null);
  }, []);

  const commitAndClose = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const latestRows = serialRowsRef.current
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean);
    const latestSerialNumber = latestRows.join(', ');

    if (latestSerialNumber !== lastSavedSerialNumberRef.current) {
      const ok = await saveSerialRows(latestRows);
      if (!ok) return;
    }

    setIsEditing(false);
    setError(null);
  }, [saveSerialRows]);

  const startEditingFromPencil = useCallback(() => {
    setSerialRows(parseSerialRows(lastSavedSerialNumberRef.current));
    setIsEditing(true);
    setError(null);
  }, []);

  const startEditingFromDisplay = useCallback(() => {
    const rows = parseSerialRows(lastSavedSerialNumberRef.current);
    const initial = rows.length > 0 ? rows : [''];
    setSerialRows(initial);
    serialRowsRef.current = initial;
    setIsEditing(true);
    setError(null);
  }, []);

  const startEditingFromEmptyPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pasted = text.trim().toUpperCase();
      const initial = pasted ? [pasted] : [''];
      setSerialRows(initial);
      serialRowsRef.current = initial;
      setIsEditing(true);
      setError(null);
    } catch {
      setSerialRows(['']);
      serialRowsRef.current = [''];
      setIsEditing(true);
      setError(null);
    }
  }, []);

  const updateRow = useCallback((index: number, rawValue: string) => {
    const nextValue = rawValue.toUpperCase();
    setSerialRows((current) => {
      const next = current.map((row, rowIndex) => (rowIndex === index ? nextValue : row));
      serialRowsRef.current = next;
      return next;
    });
    setError(null);
    setSaveState('idle');
    scheduleSkuColonExpand(index, nextValue);
  }, [scheduleSkuColonExpand]);

  const pasteRow = useCallback(async (index: number) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        const nextValue = text.trim().toUpperCase();
        setSerialRows((current) => {
          const next = current.map((row, rowIndex) => (rowIndex === index ? nextValue : row));
          serialRowsRef.current = next;
          return next;
        });
        setError(null);
        setSaveState('idle');
        scheduleSkuColonExpand(index, nextValue);
      }
    } catch {
      // noop
    }
  }, [scheduleSkuColonExpand]);

  const copyAllSerials = useCallback(() => {
    if (!normalizedSerialNumber) return;
    navigator.clipboard.writeText(normalizedSerialNumber);
  }, [normalizedSerialNumber]);

  return {
    serialRows,
    normalizedRows,
    normalizedSerialNumber,
    isEditing,
    error,
    saveState,
    addRow,
    commitAndClose,
    startEditingFromPencil,
    startEditingFromDisplay,
    startEditingFromEmptyPaste,
    updateRow,
    pasteRow,
    copyAllSerials,
  };
}
