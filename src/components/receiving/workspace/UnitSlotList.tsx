'use client';

import { useState, type ReactNode } from 'react';
import { Barcode, Plus, X } from '@/components/Icons';
import { SerialChipWithMenu } from '@/components/receiving/workspace/SerialCard';

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
  /** Compact node on the right of a collapsed row (e.g. condition badge / verdict glyph). */
  renderCollapsedMeta?: (serial: UnitLike | null, index: number) => ReactNode;
  onAddSerial: (index: number, serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitLike) => void;
  onReplaceSerial: (original: UnitLike, next: string) => void;
}

function last4(sn: string): string {
  const v = (sn || '').trim();
  return v.length > 4 ? v.slice(-4) : v;
}

/**
 * Selectable per-unit list for multi-quantity lines. One unit is expanded
 * (the selected one) and shows its serial entry + an optional meta slot
 * (condition pills for receiving). Every other unit collapses to a single
 * clickable line — Unit n/N + serial + a compact meta (condition / verdict).
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
  renderCollapsedMeta,
  onAddSerial,
  onDeleteSerial,
  onReplaceSerial,
}: Props) {
  const count = Math.max(total, saved.length, 1);
  const rows = Array.from({ length: count }, (_, i) => ({ index: i, serial: saved[i] ?? null }));

  return (
    <div className="flex flex-col divide-y divide-gray-200">
      {rows.map(({ index, serial }) =>
        index === selectedIndex ? (
          <ExpandedRow
            key={`selected-${index}-${serial?.id ?? 'empty'}`}
            index={index}
            total={count}
            serial={serial}
            disabled={disabled}
            isSubmitting={isSubmitting}
            meta={renderExpandedMeta?.(serial, index)}
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
        ),
      )}
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
      className="flex w-full cursor-pointer items-center gap-2 px-1 py-2.5 text-left transition-colors hover:bg-gray-50"
    >
      <span className="shrink-0 font-mono text-micro font-black tabular-nums text-gray-500">
        {index + 1}/{total}
      </span>
      {serial ? (
        <span className="font-mono text-sm font-bold tracking-tight text-gray-900 underline decoration-emerald-500 decoration-2 underline-offset-2">
          {last4(serial.serial_number)}
        </span>
      ) : (
        <span className="text-caption font-semibold uppercase tracking-widest text-gray-400">
          Empty · tap to scan
        </span>
      )}
      {meta ? <span className="ml-auto inline-flex items-center">{meta}</span> : null}
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
  onAddSerial: (serial: string) => void | Promise<void>;
  onDeleteSerial: (serial: UnitLike) => void;
  onReplaceSerial: (original: UnitLike, next: string) => void;
}) {
  const [scan, setScan] = useState('');
  const [editing, setEditing] = useState(false);

  const submit = () => {
    const v = scan.trim();
    if (!v || disabled) return;
    if (editing && serial) {
      if (v !== serial.serial_number) onReplaceSerial(serial, v);
      setEditing(false);
      setScan('');
      return;
    }
    void onAddSerial(v);
    setScan('');
  };

  return (
    <div className="px-1 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-micro font-black uppercase tracking-widest text-blue-700">
          Unit {index + 1}/{total}
        </span>
        {serial && !editing ? (
          <SerialChipWithMenu
            serial={serial}
            isEditing={false}
            onEdit={(s) => {
              setEditing(true);
              setScan(s.serial_number);
            }}
            onDelete={disabled ? undefined : (s) => onDeleteSerial(s as UnitLike)}
          />
        ) : null}
      </div>

      {meta ? <div className="mb-2">{meta}</div> : null}

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Barcode
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            value={scan}
            disabled={disabled || isSubmitting}
            onChange={(e) => setScan(e.target.value)}
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
            placeholder={
              editing ? 'Editing serial — Enter to save, Esc to cancel' : 'Scan Serial # for this unit'
            }
            autoComplete="off"
            spellCheck={false}
            className={`block h-10 w-full rounded-lg border bg-white pl-9 pr-8 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
              editing
                ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500/30'
                : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/30'
            }`}
          />
          {scan ? (
            <button
              type="button"
              onClick={() => {
                setScan('');
                setEditing(false);
              }}
              aria-label={editing ? 'Cancel edit' : 'Clear'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!scan.trim() || isSubmitting || disabled}
          aria-label={editing ? 'Save serial' : 'Add serial'}
          title={editing ? 'Save serial' : 'Add serial'}
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 ${
            editing ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
