'use client';

import { type ComponentProps } from 'react';
import { ConditionPills } from '../ConditionPills';
import { SerialCard } from '../SerialCard';
import { SerialMatchResult, type SerialMatchedOrder } from '../SerialMatchResult';
import { ReceivingUnitRows, type UnitSerial } from '../ReceivingUnitRows';
import type { ActiveRowSerial } from '../PoLinesAccordion';

type SerialLookupView = Pick<
  ComponentProps<typeof SerialMatchResult>,
  'state' | 'unit' | 'serial' | 'matchedOrder'
>;

/**
 * Body rendered inside the active PO line's `activeRowSlot` (PoLinesAccordion).
 * Branches on line quantity:
 *  - Multi-qty same-product line → one selectable {@link ReceivingUnitRows} row
 *    per physical unit, each with its own condition grade + serial.
 *  - Single-qty line → one {@link ConditionPills} picker + a flat serial list.
 * RETURN-type lines additionally surface a serial-match band.
 *
 * Purely presentational: every mutation is delegated to the parent's existing
 * handlers. `window.confirm` guards on delete are kept here to preserve the
 * original UX exactly.
 */
export function ActiveLineConditionSerial({
  serials,
  lineId,
  receivingId,
  quantityExpected,
  cond,
  receivingType,
  serialSubmitting,
  editingSerial,
  serialLookup,
  onFileReturnClaim,
  onSubmitSerial,
  onDeleteSerialUnit,
  onReplaceSerialUnit,
  onSetUnitGrade,
  onActiveConditionChange,
  onConditionChange,
  onEditingSerialChange,
}: {
  serials: ActiveRowSerial[];
  lineId: number;
  receivingId: number | null;
  quantityExpected: number | null;
  cond: string;
  receivingType: string;
  serialSubmitting: boolean;
  editingSerial: ActiveRowSerial | null;
  serialLookup: SerialLookupView;
  /** RETURN match CTA — pair the order + open the prefilled claim. */
  onFileReturnClaim?: (matchedOrder: SerialMatchedOrder | null) => void;
  onSubmitSerial: (raw?: string, conditionGrade?: string | null) => void;
  onDeleteSerialUnit: (serialUnitId: number, lineId?: number) => void;
  onReplaceSerialUnit: (
    original: { id: number; serial_number: string; condition_grade?: string | null },
    nextSerial: string,
  ) => void;
  onSetUnitGrade: (serialUnitId: number, grade: string) => void;
  onActiveConditionChange: (next: string | null) => void;
  onConditionChange: (next: string) => void;
  onEditingSerialChange: (next: ActiveRowSerial | null) => void;
}) {
  const isMultiQty = (quantityExpected ?? 0) > 1;
  const matchResult =
    receivingType === 'RETURN' ? (
      <SerialMatchResult
        state={serialLookup.state}
        unit={serialLookup.unit}
        serial={serialLookup.serial}
        matchedOrder={serialLookup.matchedOrder}
        onFileClaim={onFileReturnClaim}
      />
    ) : undefined;

  return (
    <div className="space-y-3">
      {isMultiQty ? (
        // Multi-qty same-product line: split into one selectable row per
        // physical unit, each with its own condition grade and serial. The
        // selected unit's grade is reported up via onActiveConditionChange so
        // the header badge + label preview track that unit.
        <>
          <ReceivingUnitRows
            lineId={lineId}
            saved={serials as UnitSerial[]}
            quantityExpected={quantityExpected ?? 1}
            lineCondition={cond}
            disabled={!receivingId}
            isSubmitting={serialSubmitting}
            serialEditTarget={editingSerial?.id != null ? (editingSerial as UnitSerial) : null}
            onAddSerial={(sn, grade) => onSubmitSerial(sn, grade)}
            onDeleteSerial={(id) => {
              if (!window.confirm('Remove this serial?')) return;
              onDeleteSerialUnit(id);
            }}
            onReplaceSerial={(original, next) => onReplaceSerialUnit(original, next)}
            onSetUnitGrade={(id, grade) => onSetUnitGrade(id, grade)}
            onConditionChange={onConditionChange}
            onActiveConditionChange={onActiveConditionChange}
          />
          {/* RETURN-only: serial-match result under the unit rows. */}
          {matchResult ?? null}
        </>
      ) : (
        // Single-qty line (incl. a PARTS product carrying several part-serials
        // under one unit): integrated condition picker + serial card.
        <SerialCard
          key={`serial-card-${lineId}`}
          saved={serials}
          expected={quantityExpected ?? null}
          isSubmitting={serialSubmitting}
          disabled={!receivingId}
          embedded
          showSavedChips={false}
          editingSerial={editingSerial}
          onEditingSerialChange={onEditingSerialChange}
          resultSlot={matchResult}
          condition={cond}
          onConditionChange={onConditionChange}
          onAdd={(sn) => onSubmitSerial(sn, cond)}
          onReplaceSerial={(original, nextSerial) => {
            if (original.id == null) return;
            onReplaceSerialUnit(
              {
                id: original.id,
                serial_number: original.serial_number,
                condition_grade: original.condition_grade,
              },
              nextSerial,
            );
          }}
          onDeleteSerial={(s) => {
            if (s.id == null) return;
            if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
            onDeleteSerialUnit(s.id);
          }}
        />
      )}
    </div>
  );
}
