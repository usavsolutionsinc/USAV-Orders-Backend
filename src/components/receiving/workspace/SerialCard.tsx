'use client';

import { useState } from 'react';
import { Barcode, X } from '@/components/Icons';

interface Props {
  /** Already-saved serials for this line (from `row.serials`). */
  saved: ReadonlyArray<{ id?: number; serial_number: string }>;
  /** Expected total (row.quantity_expected). null/0 → no target. */
  expected: number | null;
  /** Submit a new serial — calls into LineEditPanel's existing submitSerial flow. */
  onAdd: (sn: string) => void;
  /** Is a serial submission currently in flight? */
  isSubmitting: boolean;
  /** Disable input when carton/line isn't ready (no receiving_id, etc.). */
  disabled?: boolean;
  /** PO-line notes — co-located here so operators see them while scanning. */
  notes?: string;
  /** Notes change handler (controlled). */
  onNotesChange?: (next: string) => void;
  /** Persist notes on blur. */
  onNotesBlur?: () => void;
  /** DOM id for the notes textarea (used by label). */
  notesId?: string;
}

function last6(sn: string): string {
  const trimmed = String(sn || '').trim();
  if (!trimmed) return '';
  return trimmed.length <= 6 ? trimmed : trimmed.slice(-6);
}

/**
 * Top-of-workspace scan card. Hosts the everyday "scan a serial → ⏎" path
 * with chips for already-saved serials and a tally vs the expected count.
 *
 * The richer "add multiple rows / edit per-row" controls remain in the Item
 * FlowSection (inside the Details collapsible) — both surfaces ultimately
 * drive the same `submitSerial` flow in `LineEditPanel`.
 */
export function SerialCard({
  saved,
  expected,
  onAdd,
  isSubmitting,
  disabled = false,
  notes,
  onNotesChange,
  onNotesBlur,
  notesId,
}: Props) {
  const showNotes = typeof notes === 'string' && typeof onNotesChange === 'function';
  const [scan, setScan] = useState('');
  const count = saved.length;
  const target = expected ?? 0;
  const isAtCap = target > 0 && count >= target;

  const tally = target > 0
    ? `${count}/${target} scanned`
    : `${count} scanned`;
  const tallyClass = isAtCap
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : count > 0
      ? 'bg-blue-50 text-blue-700 ring-blue-200'
      : 'bg-gray-50 text-gray-600 ring-gray-200';

  const submit = () => {
    const trimmed = scan.trim();
    if (!trimmed || isSubmitting || disabled) return;
    // Allow comma-paste → submit each one in turn. Parent dedupes via the
    // existing submitSerial logic; we just feed them sequentially.
    const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    for (const sn of parts) onAdd(sn);
    setScan('');
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">
          Serial numbers
        </h3>
        <span
          className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ring-1 ${tallyClass}`}
        >
          {tally}
        </span>
      </div>

      {count > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {saved.map((s, idx) => {
            const sn = (s.serial_number || '').trim();
            if (!sn) return null;
            return (
              <span
                key={s.id ?? `${sn}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"
                title={sn}
              >
                <span className="text-emerald-600">✓</span>
                <span className="max-w-[160px] truncate">····{last6(sn)}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Barcode
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
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
              }
            }}
            placeholder={isAtCap ? 'All serials scanned' : 'Scan or type a serial → ⏎'}
            autoComplete="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- scan-focused workflow
            autoFocus
            className="block h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          />
          {scan ? (
            <button
              type="button"
              onClick={() => setScan('')}
              aria-label="Clear input"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!scan.trim() || isSubmitting || disabled}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-[12px] font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isSubmitting ? 'Adding…' : 'Add'}
        </button>
      </div>

      {/* Notes — co-located with the serial input so the operator never has
          to expand a separate section to leave context for the next person.
          Same card chrome, same width; a hairline divider signals it's a
          distinct field, not part of the scan flow. */}
      {showNotes ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <label
            htmlFor={notesId}
            className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500"
          >
            Notes
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => onNotesChange?.(e.target.value)}
            onBlur={onNotesBlur}
            rows={2}
            placeholder="PO-line notes (saved on blur)"
            className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      ) : null}
    </section>
  );
}
