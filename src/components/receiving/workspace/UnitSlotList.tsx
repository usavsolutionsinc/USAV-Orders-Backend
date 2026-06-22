'use client';

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Plus, X } from '@/components/Icons';
import { TextField } from '@/design-system/primitives';
import { ConditionBadge } from './ConditionBadge';

export interface UnitLike {
  id: number;
  serial_number: string;
  condition_grade?: string | null;
  current_status?: string;
}

interface Props {
  /** How many unit rows to render (= expected qty, min saved/1). */
  total: number;
  /** Saved serials in scan order. Index i → unit row i. */
  saved: ReadonlyArray<UnitLike>;
  /** Currently selected (expanded) unit index. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  /** Rendered inside the expanded row, above the serial input (e.g. condition pills). */
  renderExpandedMeta?: (serial: UnitLike | null, index: number) => ReactNode;
  /**
   * When true, the selected row's expanded meta (condition/verdict pills) is
   * shown immediately instead of collapsing to a text badge until hover / serial
   * focus. Use where picking the grade is the point of the row (Unbox), not an
   * afterthought to scanning.
   */
  alwaysShowExpandedMeta?: boolean;
  /**
   * Render the expanded (active) row to match the single-qty SerialCard layout:
   * drop the `n/N` counter and show the condition meta inline (no pending badge,
   * no hover-collapse). Used by the multi-qty same-SKU receiving display so the
   * active unit reads identically to a single-qty line.
   */
  singleRowExpanded?: boolean;
  /** Compact node on the right of a collapsed row (e.g. condition badge / verdict glyph). */
  renderCollapsedMeta?: (serial: UnitLike | null, index: number) => ReactNode;
  onAddSerial: (index: number, serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitLike) => void;
  onReplaceSerial: (original: UnitLike, next: string) => void;
  /** Edit from PO header {@link SerialChipWithMenu} → expanded unit scan input. */
  serialEditTarget?: UnitLike | null;
}

function last4(sn: string): string {
  const v = (sn || '').trim();
  return v.length > 4 ? v.slice(-4) : v;
}

/**
 * Selectable per-unit list for multi-quantity lines. One unit is expanded
 * (the selected one) and shows its serial entry + an optional meta slot
 * (condition pills for receiving). Every other unit collapses to a single
 * clickable line — `n/N` + condition + serial (see collapsed rows).
 * Expanded body is condition pills + scan input only (no duplicate title row).
 * Selecting a unit is what drives the workspace's print preview + print target.
 */
export function UnitSlotList({
  total,
  saved,
  selectedIndex,
  onSelect,
  disabled = false,
  isSubmitting = false,
  renderExpandedMeta,
  alwaysShowExpandedMeta = false,
  singleRowExpanded = false,
  renderCollapsedMeta,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
  serialEditTarget = null,
}: Props) {
  const count = Math.max(total, saved.length, 1);
  const rows = Array.from({ length: count }, (_, i) => ({ index: i, serial: saved[i] ?? null }));

  // All-expanded (single-row) mode: every unit shows its own open serial input.
  // A committed scan hands focus straight to the next row's input *immediately*
  // (the write is queued and processed in the background by useLineSerials), so
  // a multi-unit lot is scanned top-to-bottom in one fast pass without waiting
  // on the network. Inputs stay enabled during submit (see ExpandedRow) so the
  // newly-focused field actually accepts the next scan.
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusRow = (index: number) => {
    const el = inputRefs.current[index];
    if (el && !el.disabled) el.focus();
  };
  // First not-yet-scanned slot — autofocused on mount in all-expanded mode.
  const firstEmptyIndex = saved.length < count ? saved.length : -1;

  return (
    <div className="flex flex-col divide-y divide-gray-200">
      {rows.map(({ index, serial }) => {
        const expanded = singleRowExpanded || index === selectedIndex;
        return expanded ? (
          <ExpandedRow
            key={`row-${serial?.id ?? `empty-${index}`}`}
            index={index}
            total={count}
            serial={serial}
            disabled={disabled}
            isSubmitting={isSubmitting}
            meta={renderExpandedMeta?.(serial, index)}
            alwaysShowMeta={alwaysShowExpandedMeta || singleRowExpanded}
            singleRow={singleRowExpanded}
            serialEditTarget={
              serialEditTarget?.id != null && serial?.id === serialEditTarget.id
                ? serialEditTarget
                : null
            }
            inputRef={
              singleRowExpanded
                ? (el) => {
                    inputRefs.current[index] = el;
                  }
                : undefined
            }
            autoFocusInput={singleRowExpanded && index === firstEmptyIndex}
            onFocusRow={singleRowExpanded ? () => onSelect(index) : undefined}
            onAdvance={singleRowExpanded ? () => focusRow(index + 1) : undefined}
            onAddSerial={(sn) => onAddSerial(index, sn)}
            onDeleteSerial={onDeleteSerial}
            onReplaceSerial={onReplaceSerial}
          />
        ) : (
          <CollapsedRow
            key={serial?.id ?? `empty-${index}`}
            index={index}
            total={count}
            serial={serial}
            meta={renderCollapsedMeta?.(serial, index)}
            onSelect={() => onSelect(index)}
          />
        );
      })}
    </div>
  );
}

function UnitRowTitle({
  index,
  total,
  meta,
  trailing,
}: {
  index: number;
  total: number;
  meta: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="shrink-0 font-mono text-micro font-black tabular-nums text-gray-500">
        {index + 1}/{total}
      </span>
      {meta ? <span className="inline-flex items-center">{meta}</span> : null}
      {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
    </div>
  );
}

function CollapsedRow({
  index,
  total,
  serial,
  meta,
  onSelect,
}: {
  index: number;
  total: number;
  serial: UnitLike | null;
  meta: ReactNode;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className="w-full cursor-pointer px-1 py-2.5 text-left transition-colors hover:bg-gray-50"
    >
      <UnitRowTitle
        index={index}
        total={total}
        meta={meta}
        trailing={
          serial ? (
            <span className="font-mono text-sm font-bold tracking-tight text-gray-900 underline decoration-emerald-500 decoration-2 underline-offset-2">
              {last4(serial.serial_number)}
            </span>
          ) : (
            <span className="text-caption font-semibold uppercase tracking-widest text-gray-400">
              Empty · tap to scan
            </span>
          )
        }
      />
    </div>
  );
}

function ExpandedRow({
  index,
  total,
  serial,
  disabled,
  isSubmitting,
  meta,
  alwaysShowMeta = false,
  singleRow = false,
  serialEditTarget,
  inputRef,
  autoFocusInput = false,
  onFocusRow,
  onAdvance,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
}: {
  index: number;
  total: number;
  serial: UnitLike | null;
  disabled: boolean;
  isSubmitting: boolean;
  meta: ReactNode;
  alwaysShowMeta?: boolean;
  /** Hide the `n/N` counter so the row mirrors the single-qty SerialCard. */
  singleRow?: boolean;
  serialEditTarget: UnitLike | null;
  /** Forwarded to the serial input so the parent can advance focus between rows. */
  inputRef?: Ref<HTMLInputElement>;
  /** Autofocus this row's serial input on mount (the first empty slot). */
  autoFocusInput?: boolean;
  /** Fired when the input gains focus — lets the parent mark this unit active. */
  onFocusRow?: () => void;
  /** Fired right after a serial is committed — parent jumps focus to the next row. */
  onAdvance?: () => void;
  onAddSerial: (serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitLike) => void;
  onReplaceSerial: (original: UnitLike, next: string) => void;
}) {
  const [scan, setScan] = useState('');
  const [editing, setEditing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // When the row's whole purpose is grading (Unbox), keep the pills visible
  // instead of hiding them behind hover/serial-focus.
  const showMeta = alwaysShowMeta || isFocused || isSubmitting || scan.length > 0;

  useEffect(() => {
    if (!serialEditTarget || serial?.id !== serialEditTarget.id) return;
    setEditing(true);
    setScan(serialEditTarget.serial_number);
  }, [serial?.id, serialEditTarget]);

  const submit = () => {
    const v = scan.trim();
    if (!v || disabled) return;
    if (editing && serial) {
      if (v !== serial.serial_number) onReplaceSerial(serial, v);
      setEditing(false);
      setScan('');
      return;
    }
    // Fire-and-forget: the parent queues the write, so clear + advance focus to
    // the next row immediately instead of waiting on the network round-trip.
    void onAddSerial(v);
    setScan('');
    onAdvance?.();
  };

  return (
    <div className="px-1 py-2.5 group">
      <div className="flex items-center gap-2">
        {/* Active unit's n/N — same column as the collapsed rows so the qty +
            condition read down one vertical line instead of jumping left.
            Hidden in single-row mode so the active unit mirrors a single-qty line. */}
        {singleRow ? null : (
          <span className="shrink-0 font-mono text-micro font-black tabular-nums text-gray-500">
            {index + 1}/{total}
          </span>
        )}
        {meta ? (
          singleRow ? (
            // Single-row mode mirrors the single-qty SerialCard: condition pills
            // always visible + a hairline divider, left-aligned with the master
            // "All units" picker (no collapse/overflow, so all 7 pills show).
            <div className="flex min-w-0 items-center gap-2">
              <div className="inline-flex items-center">{meta}</div>
              <div className="h-8 w-px shrink-0 bg-gray-100" />
            </div>
          ) : (
            <div
              className={`flex items-center gap-2 transition-all duration-700 ease-in-out overflow-hidden ${
                showMeta
                  ? 'max-w-[600px] opacity-100 mr-1'
                  : 'max-w-[48px] opacity-100 group-hover:max-w-[600px] group-hover:mr-1'
              }`}
            >
              <div className={`${showMeta ? 'hidden' : 'block group-hover:hidden'}`}>
                <ConditionBadge grade={serial?.condition_grade} />
              </div>
              <div className={`${showMeta ? 'block' : 'hidden group-hover:block'}`}>
                <div className="inline-flex items-center">
                  {meta}
                </div>
              </div>
              <div className={`h-8 w-px bg-gray-100 shrink-0 ${showMeta ? 'block' : 'hidden group-hover:block'}`} />
            </div>
          )
        ) : null}

        <div className="flex-1 min-w-0">
          <TextField
            ref={inputRef}
            label="Serial"
            value={scan}
            onChange={setScan}
            tone={editing ? 'amber' : 'blue'}
            mono
            // Single-row (fast-scan) mode keeps the input live during submit so
            // the auto-advanced field accepts the next scan without waiting for
            // the queued write to settle. Other modes block during submit.
            disabled={disabled || (!singleRow && isSubmitting)}
            autoComplete="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- scan-focused workflow
            autoFocus={autoFocusInput}
            onFocus={() => {
              setIsFocused(true);
              onFocusRow?.();
            }}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && editing) {
                e.preventDefault();
                setEditing(false);
                setScan('');
              }
            }}
            trailing={
              scan ? (
                <button
                  type="button"
                  onClick={() => {
                    setScan('');
                    setEditing(false);
                  }}
                  aria-label={editing ? 'Cancel edit' : 'Clear'}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : undefined
            }
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!scan.trim() || (!singleRow && isSubmitting) || disabled}
          aria-label={editing ? 'Save serial' : 'Add serial'}
          title={editing ? 'Save serial' : 'Add serial'}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 ${
            editing ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-5 w-5">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
