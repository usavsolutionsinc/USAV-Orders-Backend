'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConditionPills } from './ConditionPills';
import { UnitSlotList, type UnitLike } from './UnitSlotList';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';

export type UnitSerial = UnitLike;

interface Props {
  /** Receiving line these units belong to. */
  lineId: number;
  /** Saved serials for the line, in scan order. Index i → unit row i. */
  saved: ReadonlyArray<UnitSerial>;
  /** Expected qty — drives how many unit rows render. */
  quantityExpected: number;
  /** Line-level grade, used as the default for not-yet-graded units. */
  lineCondition: string | null | undefined;
  disabled?: boolean;
  isSubmitting?: boolean;
  /** Scan a serial into a slot, stamping the grade chosen for that slot. */
  onAddSerial: (serial: string, conditionGrade: string | null) => void | Promise<void>;
  onDeleteSerial: (serialUnitId: number) => void;
  onReplaceSerial: (original: UnitSerial, next: string) => void;
  /** Persist a per-unit grade for an already-scanned serial. */
  onSetUnitGrade: (serialUnitId: number, grade: string) => void;
  /**
   * Set the line-level default grade. Used by the "All units" master picker to
   * stamp every unit at once (empty slots inherit it; scanned units are also
   * re-graded via {@link onSetUnitGrade}).
   */
  onConditionChange?: (grade: string) => void;
  /**
   * Fires with the effective condition grade of the currently-selected unit
   * (saved grade → pending grade → line default). Lets the parent print/preview
   * a label that matches the selected item rather than the line-level grade, so
   * a multi-qty PO with mixed conditions gets one correct label per unit.
   */
  onActiveConditionChange?: (grade: string | null) => void;
  /** Header chip Edit — routes into the matching unit's scan input. */
  serialEditTarget?: UnitSerial | null;
}

/**
 * Multi-quantity receiving display: one selectable row per physical unit so a
 * line with qty 6 of the same product is acknowledged as six units — each with
 * its own condition grade and serial. The selected unit expands (condition
 * pills + serial entry); the rest collapse to a single line. Mounts in the
 * active PO-item row of {@link PoLinesAccordion} when `quantity_expected` > 1.
 *
 * Per-unit condition persists to `serial_units.condition_grade`: a scanned unit
 * calls the grade endpoint; an empty slot holds the chosen grade locally and
 * stamps it onto the scan.
 */
export function ReceivingUnitRows({
  lineId,
  saved,
  quantityExpected,
  lineCondition,
  disabled = false,
  isSubmitting = false,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
  onSetUnitGrade,
  onConditionChange,
  onActiveConditionChange,
  serialEditTarget = null,
}: Props) {
  const total = Math.max(quantityExpected, saved.length, 1);

  // Default selection: the first not-yet-scanned slot, else the first unit.
  const firstEmpty = saved.length < total ? saved.length : 0;
  const [selectedIndex, setSelectedIndex] = useState(firstEmpty);

  // Grade chosen for empty slots before their serial is scanned, keyed by slot.
  const [pendingGrade, setPendingGrade] = useState<Record<number, string>>({});

  const gradeFor = (serial: UnitSerial | null, index: number): string | null =>
    serial?.condition_grade ?? pendingGrade[index] ?? lineCondition ?? null;

  // Surface the selected unit's effective grade to the parent (for the label
  // preview / print). Recomputed whenever the selection, that unit's saved or
  // pending grade, or the line default changes. Guarded against redundant
  // emits so the parent isn't re-rendered on every keystroke elsewhere.
  const activeGrade = gradeFor(saved[selectedIndex] ?? null, selectedIndex);
  const lastEmittedRef = useRef<string | null | undefined>(undefined);

  // Re-home selection when switching to a different line, and re-arm the emit
  // guard so the new line's selected grade is always reported even if it equals
  // the previous line's last emitted value.
  useEffect(() => {
    setSelectedIndex(saved.length < total ? saved.length : 0);
    lastEmittedRef.current = undefined;
    // Only re-seed on line change, not on every serial add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  useEffect(() => {
    if (lastEmittedRef.current === activeGrade) return;
    lastEmittedRef.current = activeGrade;
    onActiveConditionChange?.(activeGrade);
  }, [activeGrade, onActiveConditionChange]);

  useEffect(() => {
    if (serialEditTarget?.id == null) return;
    const idx = saved.findIndex((s) => s.id === serialEditTarget.id);
    if (idx >= 0) setSelectedIndex(idx);
  }, [serialEditTarget?.id, saved]);

  // "All units" master picker: stamp every unit to one grade in a single tap.
  // The line-level default covers empty/ungraded slots (via gradeFor), and each
  // already-scanned unit is re-graded explicitly so prior per-unit picks are
  // overwritten too. Per-unit rows below still override individual exceptions.
  const setAllUnits = useCallback(
    (grade: string) => {
      onConditionChange?.(grade);
      setPendingGrade({});
      for (const s of saved) {
        if (s?.id != null) onSetUnitGrade(s.id, grade);
      }
    },
    [onConditionChange, onSetUnitGrade, saved],
  );

  // Reflect the shared grade when every unit agrees; show indeterminate (no
  // active pill) when units are mixed, so the master never misreports state.
  const effectiveGrades = Array.from({ length: total }, (_, i) => gradeFor(saved[i] ?? null, i));
  const masterValue = effectiveGrades.every((g) => g === effectiveGrades[0]) ? effectiveGrades[0] : null;

  return (
    <div className="space-y-2">
      {/* Umbrella control — one tap grades the whole lot; rows below override.
          Bare pills: the position above the unit list reads as "all" from
          context, so no chrome/label needed. */}
      <ConditionPills value={masterValue} onChange={setAllUnits} />
      <UnitSlotList
        total={total}
        saved={saved}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        disabled={disabled}
        isSubmitting={isSubmitting}
        renderExpandedMeta={(serial, index) => (
          <ConditionPills
            value={gradeFor(serial, index)}
            onChange={(next) => {
              if (serial) onSetUnitGrade(serial.id, next);
              else setPendingGrade((m) => ({ ...m, [index]: next }));
            }}
          />
        )}
        renderCollapsedMeta={(serial, index) => (
          <ConditionBadge grade={gradeFor(serial, index)} />
        )}
        onAddSerial={(index, sn) => onAddSerial(sn, gradeFor(saved[index] ?? null, index))}
        onDeleteSerial={(s) => onDeleteSerial(s.id)}
        onReplaceSerial={(original, next) => onReplaceSerial(original, next)}
        serialEditTarget={serialEditTarget}
      />
    </div>
  );
}

export function ConditionBadge({ grade }: { grade: string | null | undefined }) {
  const g = String(grade || '').trim().toUpperCase();
  if (!g || g === 'PENDING') {
    return <span className="text-micro font-bold uppercase tracking-widest text-gray-400">pending</span>;
  }
  const tone =
    g === 'BRAND_NEW'
      ? 'text-yellow-600'
      : g === 'PARTS'
        ? 'text-amber-800'
        : g.startsWith('USED')
          ? 'text-gray-600'
          : 'text-gray-500';
  return (
    <span className={`text-micro font-bold uppercase tracking-widest ${tone}`}>
      {conditionGradeTableLabel(g)}
    </span>
  );
}
