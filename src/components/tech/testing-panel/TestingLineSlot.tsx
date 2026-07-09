import { TestingLinePanel, type UnitSlotSerial } from '@/components/tech/TestingUnitSlots';
import type { TestingController } from './testing-panel-types';

/** Shared confirm before removing a serial. */
export function confirmDeleteSerial(serialNumber: string): boolean {
  return window.confirm(`Remove serial ${serialNumber}?`);
}

/**
 * The verdict/serial slot for one testing line. Used by BOTH the unmatched
 * (`renderLineActions`) and the PO accordion (`activeRowSlot`) paths — the only
 * differences are the line id, expected count, disabled state, selected index,
 * and the PO-only header-serial editing affordances, all passed in.
 */
export function TestingLineSlot({
  c,
  lineId,
  serials,
  expected,
  disabled,
  selectedIndex,
  autoFocus,
  showSavedChips,
  editingSerial,
  onEditingSerialChange,
}: {
  c: TestingController;
  lineId: number;
  serials: UnitSlotSerial[];
  expected: number | null;
  disabled: boolean;
  selectedIndex: number;
  autoFocus?: boolean;
  showSavedChips?: boolean;
  editingSerial?: UnitSlotSerial | null;
  onEditingSerialChange?: (s: UnitSlotSerial | null) => void;
}) {
  return (
    <TestingLinePanel
      lineId={lineId}
      saved={serials}
      expected={expected}
      verdict={c.deriveLineVerdict(serials)}
      isSubmitting={c.serialSubmitting}
      disabled={disabled}
      autoFocus={autoFocus}
      showSavedChips={showSavedChips}
      editingSerial={editingSerial}
      onEditingSerialChange={onEditingSerialChange}
      selectedIndex={selectedIndex}
      onSelectIndex={(i) => c.setActiveSlotByLine((m) => ({ ...m, [lineId]: i }))}
      onSetVerdict={(next) => void c.applyLineVerdict(lineId, serials, next)}
      onSetUnitVerdict={(serial, next) => void c.handleSlotVerdict(lineId, serial, next)}
      onAddSerial={(sn) => c.enqueueSerial(lineId, sn)}
      onDeleteSerial={(s) => {
        if (s.id == null) return;
        if (!confirmDeleteSerial(s.serial_number)) return;
        void c.deleteSerial(lineId, s.id);
      }}
      onReplaceSerial={(original, next) => void c.replaceSerial(lineId, original, next)}
    />
  );
}
