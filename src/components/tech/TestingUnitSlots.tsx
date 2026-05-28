'use client';

import {
  TestingStatusPills,
  unitStatusToVerdict,
  type TestingVerdict,
} from '@/components/receiving/workspace/TestingStatusPills';
import { InlineSerialAdder } from '@/components/receiving/workspace/InlineSerialAdder';
import { UnitSlotList } from '@/components/receiving/workspace/UnitSlotList';

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
  /** Selected (expanded) unit index for multi-qty lines — drives the print preview. */
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  /** Apply one verdict to the whole unit / PO line. */
  onSetVerdict: (next: TestingVerdict) => void;
  onAddSerial: (serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitSlotSerial) => void;
  onReplaceSerial: (original: UnitSlotSerial, next: string) => void;
}

/**
 * Per-line testing panel for the tech workspace. Mounts inside the active
 * row of {@link PoLinesAccordion} (matched cartons) or each line of
 * {@link UnmatchedItemsSection}. One verdict covers the whole unit / PO line.
 *
 * - qty ≤ 1 (incl. a PARTS product with several part-serials under one unit):
 *   verdict pills + the shared {@link InlineSerialAdder}.
 * - qty > 1 (e.g. 6 of the same product): verdict pills on top, then a
 *   selectable per-unit list. The selected unit expands its serial entry and
 *   becomes the print target (SKU + serial) in the workspace's label preview.
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
  selectedIndex = 0,
  onSelectIndex,
  onSetVerdict,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
}: Props) {
  const total = Math.max(expected ?? saved.length, saved.length, 1);
  const multi = total > 1;

  return (
    <div className="space-y-3">
      <TestingStatusPills
        value={verdict}
        onChange={onSetVerdict}
        disabled={disabled || isMutating || saved.length === 0}
      />
      {multi ? (
        <UnitSlotList
          total={total}
          saved={saved}
          selectedIndex={selectedIndex}
          onSelect={onSelectIndex ?? (() => {})}
          disabled={disabled}
          isSubmitting={isSubmitting}
          renderCollapsedMeta={(serial) => (
            <VerdictGlyph verdict={unitStatusToVerdict(serial?.current_status)} />
          )}
          onAddSerial={(_index, sn) => onAddSerial(sn)}
          onDeleteSerial={(s) => onDeleteSerial(s as UnitSlotSerial)}
          onReplaceSerial={(original, next) => onReplaceSerial(original as UnitSlotSerial, next)}
        />
      ) : (
        <InlineSerialAdder
          key={`tech-adder-${lineId}`}
          lineId={lineId}
          saved={saved}
          expected={expected}
          isSubmitting={isSubmitting}
          disabled={disabled}
          autoFocus={autoFocus}
          onAdd={(_lineId, sn) => onAddSerial(sn)}
          onDelete={(_lineId, s) => onDeleteSerial(s as UnitSlotSerial)}
          onReplaceSerial={(_lineId, original, next) =>
            onReplaceSerial(original as UnitSlotSerial, next)
          }
        />
      )}
    </div>
  );
}

function VerdictGlyph({ verdict }: { verdict: TestingVerdict | null }) {
  const cls = 'text-micro font-bold uppercase tracking-widest';
  if (verdict === 'PASS') return <span className={`${cls} text-emerald-700`}>Pass</span>;
  if (verdict === 'TEST_AGAIN') return <span className={`${cls} text-amber-700`}>Re-test</span>;
  if (verdict === 'TESTING_FAILED') return <span className={`${cls} text-rose-700`}>Failed</span>;
  return <span className={`${cls} text-gray-400`}>No verdict</span>;
}
