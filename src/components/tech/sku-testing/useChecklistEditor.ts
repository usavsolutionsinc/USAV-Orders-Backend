'use client';

import { useCallback, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  addQcCheck,
  bulkSetChecklist,
  deleteQcCheck,
  recordChecklistStep,
  updateQcCheck,
} from './sku-testing-api';
import { NUMERIC_VALUE_KINDS, type ChecklistStep, type UnitResult } from './sku-testing-types';

interface Params {
  receivingLineId: number;
  steps: ChecklistStep[];
  serialUnitId: number | null;
  results: Record<number, UnitResult>;
  onChanged: () => Promise<void>;
  onReloadResults: () => Promise<void>;
  onResultChange: (stepId: number, next: Partial<UnitResult>) => void;
}

/**
 * All template-editing (add/edit/delete steps) and per-unit recording
 * (pass/fail toggle, structured value, bulk pass/clear) for one line's checklist,
 * plus the transient edit UI state. Optimistic toggles roll back on error.
 */
export function useChecklistEditor({
  receivingLineId,
  steps,
  serialUnitId,
  results,
  onChanged,
  onReloadResults,
  onResultChange,
}: Params) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [recordingStep, setRecordingStep] = useState<number | null>(null);

  const done = steps.filter((s) => results[s.step_id]?.passed === true).length;
  const allDone = steps.length > 0 && done === steps.length;

  // Bulk settle: pass (or clear) every step for this unit, then refresh from the
  // server so attribution (who/when) reflects the write.
  const bulkSet = useCallback(
    async (action: 'pass' | 'clear') => {
      if (serialUnitId == null) return;
      setBulkBusy(true);
      try {
        await bulkSetChecklist(serialUnitId, action);
        await onReloadResults();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update checklist');
      } finally {
        setBulkBusy(false);
      }
    },
    [serialUnitId, onReloadResults],
  );

  const addStep = useCallback(async () => {
    const label = draft.trim();
    if (!label) return;
    setBusy(true);
    try {
      await addQcCheck(receivingLineId, label, steps.length);
      setDraft('');
      setAdding(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add step');
    } finally {
      setBusy(false);
    }
  }, [draft, receivingLineId, steps.length, onChanged]);

  const saveEdit = useCallback(async () => {
    if (editingId == null) return;
    const label = editLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      await updateQcCheck(receivingLineId, editingId, label);
      setEditingId(null);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save step');
    } finally {
      setBusy(false);
    }
  }, [editingId, editLabel, receivingLineId, onChanged]);

  const removeStep = useCallback(
    async (stepId: number) => {
      if (!window.confirm('Remove this checklist step for the whole SKU?')) return;
      setBusy(true);
      try {
        await deleteQcCheck(receivingLineId, stepId);
        await onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not delete step');
      } finally {
        setBusy(false);
      }
    },
    [receivingLineId, onChanged],
  );

  const toggleRecord = useCallback(
    async (step: ChecklistStep) => {
      if (serialUnitId == null) return;
      const nextPassed = results[step.step_id]?.passed !== true;
      setRecordingStep(step.step_id);
      onResultChange(step.step_id, { passed: nextPassed });
      try {
        await recordChecklistStep(serialUnitId, { stepId: step.step_id, passed: nextPassed });
      } catch (err) {
        onResultChange(step.step_id, { passed: !nextPassed });
        toast.error(err instanceof Error ? err.message : 'Could not record step');
      } finally {
        setRecordingStep(null);
      }
    },
    [serialUnitId, results, onResultChange],
  );

  // Record a structured value (number/enum/text). The server derives pass/fail
  // for numeric pass-band steps, so we reload results afterward to reflect it.
  const recordValue = useCallback(
    async (step: ChecklistStep, raw: string) => {
      if (serialUnitId == null) return;
      const isNumeric = NUMERIC_VALUE_KINDS.has(step.value_kind ?? '');
      const body: { stepId: number; valueNum?: number; valueText?: string | null } = { stepId: step.step_id };
      if (isNumeric) {
        if (raw.trim() === '') return;
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          toast.error('Enter a valid number');
          return;
        }
        body.valueNum = n;
      } else {
        body.valueText = raw.trim() || null;
      }
      setRecordingStep(step.step_id);
      try {
        await recordChecklistStep(serialUnitId, body);
        await onReloadResults();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not record value');
      } finally {
        setRecordingStep(null);
      }
    },
    [serialUnitId, onReloadResults],
  );

  return {
    adding, setAdding,
    draft, setDraft,
    editingId, setEditingId,
    editLabel, setEditLabel,
    busy,
    bulkBusy,
    recordingStep,
    done, allDone,
    bulkSet, addStep, saveEdit, removeStep, toggleRecord, recordValue,
  };
}

export type ChecklistEditor = ReturnType<typeof useChecklistEditor>;
