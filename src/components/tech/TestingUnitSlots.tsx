'use client';

import {
  TestingStatusPills,
  type TestingVerdict,
} from '@/components/receiving/workspace/TestingStatusPills';
import { InlineSerialAdder } from '@/components/receiving/workspace/InlineSerialAdder';

export interface UnitSlotSerial {
  id: number;
  serial_number: string;
  current_status?: string;
  condition_grade?: string | null;
}

interface Props {
  /** Receiving line being tested. The verdict + serials both bind to it. */
  lineId: number;
  /**
   * The line's saved serials. A PARTS product can carry several serials
   * (different parts of the same unit) — they all list together under one
   * verdict. Inventory-level serial disambiguation is deferred.
   */
  saved: ReadonlyArray<UnitSlotSerial>;
  /** Expected qty for the line — > 1 splits into selectable per-unit rows. */
  expected?: number | null;
  /** Single line-level verdict, derived from the saved serials' statuses. */
  verdict: TestingVerdict | null;
  /** True while a verdict mutation is in flight. */
  isMutating?: boolean;
  /** True while a serial add/replace is in flight. */
  isSubmitting?: boolean;
  /** Disable the whole panel (no carton, line locked, saving, etc.). */
  disabled?: boolean;
  /** Autofocus the serial input when the line becomes active. */
  autoFocus?: boolean;
  /**
   * Accepted but unused — the testing panel renders one entry per line
   * regardless of qty, so there is no per-unit selection. Kept so existing
   * call sites in the workspace need no change.
   */
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  /** Apply one verdict to the whole unit / PO line. */
  onSetVerdict: (next: TestingVerdict) => void;
  onAddSerial: (serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitSlotSerial) => void;
  onReplaceSerial: (original: UnitSlotSerial, next: string) => void;
  /**
   * When false, the saved serial chips are rendered by a parent header
   * (e.g. {@link PoLinesAccordion}'s active row) instead of here, so the
   * adder hides its own chip list to avoid showing the serials twice.
   * Defaults to true for surfaces without a header chip list (unmatched).
   */
  showSavedChips?: boolean;
  /**
   * Controlled edit target from a parent header chip's Edit menu item. When
   * set, the scan input is populated with this serial for in-place editing.
   */
  editingSerial?: UnitSlotSerial | null;
  onEditingSerialChange?: (serial: UnitSlotSerial | null) => void;
}

/**
 * Per-line testing panel for the tech workspace. Mounts inside the active
 * row of {@link PoLinesAccordion} (matched cartons) or each line of
 * {@link UnmatchedItemsSection}. One verdict covers the whole unit / PO line.
 *
 * Regardless of qty, a line is ONE entry: verdict pills on top, then a single
 * {@link InlineSerialAdder}. A line's serials — whether several part-serials of
 * one product or several of the same product — all list as chips above the
 * input, never as separate rows below it. (Per-unit condition/serial breakdown
 * is a receiving concern, not testing, where the verdict is line-wide.)
 *
 * No nested card — the host accordion row's border is the only container.
 */
export function TestingLinePanel({
  lineId,
  saved,
  expected = null,
  verdict,
  isMutating = false,
  isSubmitting = false,
  disabled = false,
  autoFocus = false,
  onSetVerdict,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
  showSavedChips = true,
  editingSerial = null,
  onEditingSerialChange,
}: Props) {
  return (
    <div className="space-y-3">
      <TestingStatusPills
        value={verdict}
        onChange={onSetVerdict}
        disabled={disabled || isMutating || saved.length === 0}
      />
      <InlineSerialAdder
        key={`tech-adder-${lineId}`}
        lineId={lineId}
        saved={saved}
        expected={expected}
        isSubmitting={isSubmitting}
        disabled={disabled}
        autoFocus={autoFocus}
        showSavedChips={showSavedChips}
        editingSerial={editingSerial}
        onEditingSerialChange={(s) =>
          onEditingSerialChange?.(s as UnitSlotSerial | null)
        }
        onAdd={(_lineId, sn) => onAddSerial(sn)}
        onDelete={(_lineId, s) => onDeleteSerial(s as UnitSlotSerial)}
        onReplaceSerial={(_lineId, original, next) =>
          onReplaceSerial(original as UnitSlotSerial, next)
        }
      />
    </div>
  );
}
