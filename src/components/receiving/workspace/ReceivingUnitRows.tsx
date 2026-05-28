'use client';

import { useEffect, useState } from 'react';
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
}: Props) {
  const total = Math.max(quantityExpected, saved.length, 1);

  // Default selection: the first not-yet-scanned slot, else the first unit.
  const firstEmpty = saved.length < total ? saved.length : 0;
  const [selectedIndex, setSelectedIndex] = useState(firstEmpty);

  // Re-home selection when switching to a different line.
  useEffect(() => {
    setSelectedIndex(saved.length < total ? saved.length : 0);
    // Only re-seed on line change, not on every serial add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  // Grade chosen for empty slots before their serial is scanned, keyed by slot.
  const [pendingGrade, setPendingGrade] = useState<Record<number, string>>({});

  const gradeFor = (serial: UnitSerial | null, index: number): string | null =>
    serial?.condition_grade ?? pendingGrade[index] ?? lineCondition ?? null;

  return (
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
    />
  );
}

function ConditionBadge({ grade }: { grade: string | null | undefined }) {
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
