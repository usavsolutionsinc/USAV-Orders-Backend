'use client';

/**
 * ShortPickSheet — collects a reason when the picker confirms fewer units than
 * planned for an order line. Reusable for both pick and pack short-completes.
 *
 * Why a sheet, not a toast or inline form: short-picks are decisions that
 * change inventory math (a release of allocated units back to STOCKED), so
 * they need a deliberate confirmation surface — not something the worker can
 * tap through by accident.
 *
 * The sheet does NOT call any API itself — the parent decides what to do with
 * the (qty, reason, note) tuple. That keeps it usable in both the pick flow
 * (release the unallocated remainder) and the pack flow (write a packer_log
 * exception and continue).
 */

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';

export type ShortPickReason =
  | 'NOT_FOUND_IN_BIN'
  | 'DAMAGED'
  | 'WRONG_CONDITION'
  | 'MISLABELED'
  | 'INSUFFICIENT_STOCK'
  | 'OTHER';

const REASON_OPTIONS: ReadonlyArray<{
  value: ShortPickReason;
  label: string;
  hint: string;
}> = [
  { value: 'NOT_FOUND_IN_BIN',   label: 'Not in bin',         hint: 'Expected here, not present' },
  { value: 'DAMAGED',            label: 'Damaged',            hint: 'Visible damage — needs hold' },
  { value: 'WRONG_CONDITION',    label: 'Wrong condition',    hint: "Grade doesn't match order" },
  { value: 'MISLABELED',         label: 'Mislabeled',         hint: 'SKU on unit ≠ bin label' },
  { value: 'INSUFFICIENT_STOCK', label: 'Insufficient stock', hint: 'Fewer units exist than planned' },
  { value: 'OTHER',              label: 'Other',              hint: 'Add a note below' },
];

export interface ShortPickResult {
  pickedQty: number;
  plannedQty: number;
  reason: ShortPickReason;
  note: string;
}

interface ShortPickSheetProps {
  open: boolean;
  onClose: () => void;
  /** Quantity the worker is reporting as actually picked. */
  pickedQty: number;
  /** Quantity the order line called for. */
  plannedQty: number;
  /** Product display (title, SKU, last-4 tracking). */
  productLabel: string;
  /** Called with the captured reason; parent persists the result. */
  onConfirm: (result: ShortPickResult) => void;
}

export function ShortPickSheet({
  open,
  onClose,
  pickedQty,
  plannedQty,
  productLabel,
  onConfirm,
}: ShortPickSheetProps) {
  const [reason, setReason] = useState<ShortPickReason | null>(null);
  const [note, setNote] = useState('');
  const missing = Math.max(0, plannedQty - pickedQty);

  // Reset selection each time the sheet opens fresh.
  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
    }
  }, [open]);

  const noteRequired = reason === 'OTHER';
  const canSubmit = reason !== null && (!noteRequired || note.trim().length > 0);

  const handleConfirm = () => {
    if (!canSubmit || reason == null) return;
    onConfirm({ pickedQty, plannedQty, reason, note: note.trim() });
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Short pick — confirm reason">
      {/* Quantity headline */}
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          Picking {pickedQty} of {plannedQty}
        </p>
        <p className="mt-0.5 text-sm font-medium text-amber-900">
          {missing} short — releases {missing} unit{missing === 1 ? '' : 's'} back to stock
        </p>
        <p className="mt-1 text-xs text-amber-800/80 truncate">{productLabel}</p>
      </div>

      {/* Reason list — large tap targets, single-select */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Why are you short?
        </legend>
        {REASON_OPTIONS.map((opt) => {
          const selected = reason === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setReason(opt.value)}
              aria-pressed={selected}
              className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors min-h-[56px] ${
                selected
                  ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-200'
                  : 'border-gray-200 bg-white active:bg-gray-50'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${
                  selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'
                }`}
              >
                {selected && (
                  <svg viewBox="0 0 20 20" fill="none" className="h-full w-full text-white">
                    <path
                      d="M5 10l3 3 7-7"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${selected ? 'text-blue-900' : 'text-gray-900'}`}>
                  {opt.label}
                </span>
                <span className="block text-xs text-gray-500">{opt.hint}</span>
              </span>
            </button>
          );
        })}
      </fieldset>

      {/* Note */}
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          Note {noteRequired ? <span className="text-red-600">· required</span> : <span className="text-gray-400">· optional</span>}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={noteRequired ? 'Describe what happened…' : 'Add context if useful'}
          className="w-full resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
        />
      </label>

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canSubmit}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-amber-500/30 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 sm:flex-1"
        >
          Confirm short pick
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 sm:flex-1"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
