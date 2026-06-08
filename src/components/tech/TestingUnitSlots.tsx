'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TestingStatusPills,
  unitStatusToVerdict,
  type TestingVerdict,
} from '@/components/receiving/workspace/TestingStatusPills';
import { InlineSerialAdder } from '@/components/receiving/workspace/InlineSerialAdder';
import { UnitSlotList, type UnitLike } from '@/components/receiving/workspace/UnitSlotList';

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
   * The line's saved serials in scan order. Index i → unit row i. A multi-qty
   * line lists each physical unit as its own row so every PO item carries its
   * own testing verdict + serial.
   */
  saved: ReadonlyArray<UnitSlotSerial>;
  /** Expected qty for the line — > 1 splits into selectable per-unit rows. */
  expected?: number | null;
  /** Line-level verdict, derived from the saved serials' statuses. */
  verdict: TestingVerdict | null;
  /** True while a verdict mutation is in flight. */
  isMutating?: boolean;
  /** True while a serial add/replace is in flight. */
  isSubmitting?: boolean;
  /** Disable the whole panel (no carton, line locked, saving, etc.). */
  disabled?: boolean;
  /** Autofocus the serial input when the line becomes active (single-qty only). */
  autoFocus?: boolean;
  /** Currently selected (expanded) unit index for multi-qty lines. */
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  /** Apply one verdict to every serial on the unit / PO line (single-qty path). */
  onSetVerdict: (next: TestingVerdict) => void;
  /**
   * Record a verdict against a single unit. Multi-qty lines call this per row
   * so each PO item gets its own pass/test-again/fail. Falls back to
   * {@link onSetVerdict} when absent.
   */
  onSetUnitVerdict?: (serial: UnitSlotSerial, next: TestingVerdict) => void;
  onAddSerial: (serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitSlotSerial) => void;
  onReplaceSerial: (original: UnitSlotSerial, next: string) => void;
  /**
   * When false, the saved serial chips are rendered by a parent header
   * (e.g. {@link PoLinesAccordion}'s active row) instead of here, so the
   * single-qty adder hides its own chip list to avoid showing serials twice.
   * Defaults to true for surfaces without a header chip list (unmatched).
   */
  showSavedChips?: boolean;
  /**
   * Controlled edit target from a parent header chip's Edit menu item. When
   * set, the matching unit's scan input is populated for in-place editing.
   */
  editingSerial?: UnitSlotSerial | null;
  onEditingSerialChange?: (serial: UnitSlotSerial | null) => void;
}

/**
 * Per-line testing panel for the tech workspace. Mounts inside the active
 * row of {@link PoLinesAccordion} (matched cartons) or each line of
 * {@link UnmatchedItemsSection}.
 *
 * A multi-quantity line (expected > 1) renders exactly like the receiving
 * display: one selectable row per physical unit. The selected unit expands to
 * its testing verdict pills + serial entry; the rest collapse to a single line
 * (`n/N` + verdict + serial last-4). This lets a tech record an individual
 * pass / test-again / fail per PO item, since each unit's verdict binds to its
 * own `serial_units` row.
 *
 * A single-quantity line keeps the compact layout: line-wide verdict pills on
 * top, then one {@link InlineSerialAdder}.
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
  selectedIndex,
  onSelectIndex,
  onSetVerdict,
  onSetUnitVerdict,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
  showSavedChips = true,
  editingSerial = null,
  onEditingSerialChange,
}: Props) {
  const total = Math.max(expected ?? 0, saved.length, 1);

  // Multi-qty lines list each unit as its own row (receiving parity).
  if (total > 1) {
    return (
      <TestingUnitRows
        lineId={lineId}
        saved={saved}
        total={total}
        isMutating={isMutating}
        isSubmitting={isSubmitting}
        disabled={disabled}
        selectedIndex={selectedIndex}
        onSelectIndex={onSelectIndex}
        onSetUnitVerdict={(serial, next) =>
          (onSetUnitVerdict ?? (() => onSetVerdict(next)))(serial, next)
        }
        onAddSerial={onAddSerial}
        onDeleteSerial={onDeleteSerial}
        onReplaceSerial={onReplaceSerial}
        serialEditTarget={editingSerial}
      />
    );
  }

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

interface TestingUnitRowsProps {
  lineId: number;
  saved: ReadonlyArray<UnitSlotSerial>;
  total: number;
  isMutating: boolean;
  isSubmitting: boolean;
  disabled: boolean;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  onSetUnitVerdict: (serial: UnitSlotSerial, next: TestingVerdict) => void;
  onAddSerial: (serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitSlotSerial) => void;
  onReplaceSerial: (original: UnitSlotSerial, next: string) => void;
  serialEditTarget?: UnitSlotSerial | null;
}

/**
 * Multi-quantity testing display: one selectable row per physical unit, so a
 * line with qty 4 of the same SKU is acknowledged as four units — each with its
 * own testing verdict and serial. Mirrors {@link ReceivingUnitRows}, swapping
 * the condition picker for {@link TestingStatusPills}.
 *
 * The verdict binds to a scanned unit's `serial_units` row, so the pills are
 * disabled on an empty slot — scan the serial first, then pick a verdict.
 */
function TestingUnitRows({
  lineId,
  saved,
  total,
  isMutating,
  isSubmitting,
  disabled,
  selectedIndex,
  onSelectIndex,
  onSetUnitVerdict,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
  serialEditTarget = null,
}: TestingUnitRowsProps) {
  // Local selection fallback when the parent doesn't control it: default to the
  // first not-yet-scanned slot, else the first unit.
  const firstEmpty = saved.length < total ? saved.length : 0;
  const [localIndex, setLocalIndex] = useState(firstEmpty);
  const selected = selectedIndex ?? localIndex;
  const select = onSelectIndex ?? setLocalIndex;

  // Re-home selection when switching lines (uncontrolled mode only).
  useEffect(() => {
    if (selectedIndex == null) setLocalIndex(saved.length < total ? saved.length : 0);
    // Only re-seed on line change, not on every serial add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  return (
    <UnitSlotList
      total={total}
      saved={saved}
      selectedIndex={selected}
      onSelect={select}
      disabled={disabled}
      isSubmitting={isSubmitting}
      // Match the receiving display: every unit is an always-open row (verdict
      // pills + serial input, no n/N counter), and a committed scan advances
      // focus to the next unit so a lot is scanned in one fast pass.
      singleRowExpanded
      renderExpandedMeta={(serial) => (
        <TestingStatusPills
          value={unitStatusToVerdict(serial?.current_status)}
          onChange={(next) => {
            if (serial) onSetUnitVerdict(serial as UnitSlotSerial, next);
          }}
          disabled={disabled || isMutating || serial == null}
        />
      )}
      renderCollapsedMeta={(serial) => (
        <VerdictBadge verdict={unitStatusToVerdict(serial?.current_status)} />
      )}
      onAddSerial={(_index, sn) => onAddSerial(sn)}
      onDeleteSerial={(s) => onDeleteSerial(s as UnitSlotSerial)}
      onReplaceSerial={(original, next) =>
        onReplaceSerial(original as UnitSlotSerial, next)
      }
      serialEditTarget={(serialEditTarget as UnitLike | null) ?? null}
    />
  );
}

const VERDICT_BADGE: Record<TestingVerdict, { label: string; tone: string }> = {
  PASS: { label: 'pass', tone: 'text-emerald-600' },
  TEST_AGAIN: { label: 'test again', tone: 'text-amber-600' },
  TESTING_FAILED: { label: 'failed', tone: 'text-rose-600' },
};

function VerdictBadge({ verdict }: { verdict: TestingVerdict | null }) {
  if (!verdict) {
    return (
      <span className="text-micro font-bold uppercase tracking-widest text-gray-400">
        untested
      </span>
    );
  }
  const { label, tone } = VERDICT_BADGE[verdict];
  return (
    <span className={`text-micro font-bold uppercase tracking-widest ${tone}`}>
      {label}
    </span>
  );
}
