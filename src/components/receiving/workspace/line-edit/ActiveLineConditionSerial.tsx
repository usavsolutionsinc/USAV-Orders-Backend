'use client';

import { type ComponentProps } from 'react';
import { ConditionPills } from '../ConditionPills';
import { SerialCard } from '../SerialCard';
import { SerialMatchResult, type SerialMatchedOrder } from '../SerialMatchResult';
import { ReceivingUnitRows, type UnitSerial } from '../ReceivingUnitRows';
import type { ActiveRowSerial } from '../PoLinesAccordion';
import { NoSerialControl, type SerialAbsentState } from './NoSerialControl';
import { useSetting } from '@/hooks/useSettings';

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
 * handlers. The `window.confirm` guards on delete are gated by the
 * `receiving.confirmSerialRemoval` org setting (Settings Registry; default on).
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
  serialAbsent,
  serialAbsentReason,
  onSerialAbsentChange,
  requireSerialConfirmation,
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
  /** No-serial waiver state (single-qty only) + handler, from the controller. */
  serialAbsent: boolean;
  serialAbsentReason: string | null;
  onSerialAbsentChange: (next: SerialAbsentState) => void;
  /** Org enforces the serial checkpoint — surfaces the "required" hint. */
  requireSerialConfirmation: boolean;
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
  // Settings Registry: org policy for the destructive serial-remove confirm
  // (default on — falls back to the prior always-confirm UX while loading).
  const { value: confirmSerialRemoval } = useSetting<boolean>(
    'receiving',
    'receiving.confirmSerialRemoval',
  );
  const shouldConfirmRemoval = confirmSerialRemoval ?? true;
  const isMultiQty = (quantityExpected ?? 0) > 1;
  // Surface the serial-match band whenever a lookup is active (a return detected
  // on ANY line) or on a pre-typed RETURN line. SerialMatchResult self-hides on
  // idle, so this is only an allocation guard — a non-return scan shows nothing.
  const matchResult =
    serialLookup.state !== 'idle' || receivingType === 'RETURN' ? (
      <SerialMatchResult
        state={serialLookup.state}
        unit={serialLookup.unit}
        serial={serialLookup.serial}
        matchedOrder={serialLookup.matchedOrder}
        onFileClaim={onFileReturnClaim}
      />
    ) : undefined;

  return (
    <div className="min-w-0 space-y-3">
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
              if (shouldConfirmRemoval && !window.confirm('Remove this serial?')) return;
              onDeleteSerialUnit(id);
            }}
            onReplaceSerial={(original, next) => onReplaceSerialUnit(original, next)}
            onSetUnitGrade={(id, grade) => onSetUnitGrade(id, grade)}
            onConditionChange={onConditionChange}
            onActiveConditionChange={onActiveConditionChange}
            // Icon-only no-serial toggle in the top-right of the unit list.
            noSerialControl={
              <NoSerialControl
                variant="check"
                absent={serialAbsent}
                reason={serialAbsentReason}
                required={requireSerialConfirmation}
                disabled={!receivingId}
                onChange={onSerialAbsentChange}
              />
            }
          />
          {/* RETURN-only: serial-match result under the unit rows. */}
          {matchResult ?? null}
        </>
      ) : (
        // Single-qty line (incl. a PARTS product carrying several part-serials
        // under one unit): integrated condition picker + serial card. The
        // no-serial waiver sits directly under the input when no serial exists.
        <>
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
          noSerialActive={serialAbsent}
          onMarkNoSerial={() =>
            onSerialAbsentChange(
              serialAbsent
                ? { absent: false, reason: null }
                : { absent: true, reason: serialAbsentReason ?? 'NOT_SERIALIZED' },
            )
          }
          noSerialSlot={
            <NoSerialControl
              absent
              fullWidth
              reason={serialAbsentReason}
              required={requireSerialConfirmation}
              disabled={!receivingId}
              onChange={onSerialAbsentChange}
            />
          }
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
            if (shouldConfirmRemoval && !window.confirm(`Remove serial ${s.serial_number}?`)) return;
            onDeleteSerialUnit(s.id);
          }}
        />
        </>
      )}
    </div>
  );
}
