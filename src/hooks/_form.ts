import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from './_storage';
import { retry, safeAwait } from '@/utils';

// ─── useAutoSaveForm ──────────────────────────────────────────────────────────

interface UseAutoSaveFormOptions<T extends Record<string, unknown>> {
  /**
   * Unique localStorage key for draft persistence.
   * Use a constant from STORAGE_KEYS (e.g. STORAGE_KEYS.repairEditDraft(id)).
   */
  storageKey: string;
  /** Starting values — used only when no draft exists in localStorage. */
  initialValues: T;
  /**
   * Async function called (debounced) after every field change.
   * Fire-and-forget — failures update `saveError` but do not block the UI.
   */
  onSave: (values: T) => Promise<unknown>;
  /** Called on explicit submit — draft is cleared on success. */
  onSubmit?: (values: T) => Promise<unknown>;
  /** Debounce delay in ms before triggering `onSave`. Default: 1500 ms. */
  saveDebounceMs?: number;
}

interface UseAutoSaveFormReturn<T> {
  values: T;
  /** Update a single field and trigger autosave. */
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Patch multiple fields at once and trigger autosave. */
  setValues: (patch: Partial<T>) => void;
  /** Call on form submit. Runs final save, clears draft on success. */
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  /** True when the form differs from the last cleared/submitted state. */
  isDirty: boolean;
  /** True while an async DB save is in-flight. */
  isSaving: boolean;
  /** Last save error, or null. */
  saveError: Error | null;
  /** Manually clear the draft from localStorage and reset dirty state. */
  clearDraft: () => void;
}

/**
 * Auto-saves form state to localStorage on every change (synchronous) and
 * debounces an async DB write. Restores the draft on mount.
 *
 * @example
 * const { values, setField, handleSubmit, isSaving } = useAutoSaveForm({
 *   storageKey: STORAGE_KEYS.repairEditDraft(repairId),
 *   initialValues: { notes: '', status: 'pending' },
 *   onSave: (v) => updateRepairDraft(repairId, v),
 *   onSubmit: (v) => submitRepair(repairId, v),
 * });
 */
export function useAutoSaveForm<T extends Record<string, unknown>>({
  storageKey,
  initialValues,
  onSave,
  onSubmit,
  saveDebounceMs = 1500,
}: UseAutoSaveFormOptions<T>): UseAutoSaveFormReturn<T> {
  const [draft, setDraft, clearDraftStorage] = useLocalStorage<T>(storageKey, initialValues);
  const [values, setValuesState] = useState<T>(draft ?? initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const latestValues = useRef(values);
  latestValues.current = values;

  // Restore draft on mount
  useEffect(() => {
    if (draft) setValuesState(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Write to localStorage immediately, then debounce the DB call. */
  const persist = useCallback(
    (nextValues: T) => {
      setDraft(nextValues);
      setIsDirty(true);

      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setIsSaving(true);
        setSaveError(null);
        const [, err] = await safeAwait(
          retry(() => onSave(latestValues.current), 3, 500),
        );
        if (err) setSaveError(err);
        setIsSaving(false);
      }, saveDebounceMs);
    },
    [setDraft, onSave, saveDebounceMs],
  );

  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValuesState((prev) => {
        const next = { ...prev, [field]: value };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setValues = useCallback(
    (patch: Partial<T>) => {
      setValuesState((prev) => {
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      clearTimeout(saveTimer.current);

      if (onSubmit) {
        setIsSaving(true);
        const [, err] = await safeAwait(
          retry(() => onSubmit(latestValues.current), 3, 500),
        );
        setIsSaving(false);
        if (err) {
          setSaveError(err);
          return;
        }
      }

      clearDraftStorage();
      setIsDirty(false);
    },
    [onSubmit, clearDraftStorage],
  );

  const clearDraft = useCallback(() => {
    clearTimeout(saveTimer.current);
    clearDraftStorage();
    setValuesState(initialValues);
    setIsDirty(false);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearDraftStorage]);

  return {
    values,
    setField,
    setValues,
    handleSubmit,
    isDirty,
    isSaving,
    saveError,
    clearDraft,
  };
}

// ─── useUnsavedWarning ────────────────────────────────────────────────────────

/**
 * Shows a native browser "unsaved changes" dialog when the user tries to
 * close/navigate away from a page with a dirty form.
 *
 * @example
 * const { isDirty } = useAutoSaveForm({ ... });
 * useUnsavedWarning(isDirty);
 */
export function useUnsavedWarning(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome requires returnValue to be set
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
