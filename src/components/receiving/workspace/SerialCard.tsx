'use client';

import { useEffect, useRef, useState } from 'react';
import { Barcode, X } from '@/components/Icons';
import { SerialChip } from '@/components/ui/CopyChip';

interface SavedSerial {
  id?: number;
  serial_number: string;
}

interface Props {
  /** Already-saved serials for this line (from `row.serials`). */
  saved: ReadonlyArray<SavedSerial>;
  /** Expected total (row.quantity_expected). null/0 → no target. */
  expected: number | null;
  /**
   * Submit a new serial — calls into LineEditPanel's existing submitSerial
   * flow. Returning a Promise lets the paste-loop below `await` each
   * submission so the server-side FOR UPDATE lock actually serializes work.
   */
  onAdd: (sn: string) => void | Promise<void>;
  /** Is a serial submission currently in flight? */
  isSubmitting: boolean;
  /** Disable input when package/line isn't ready (no receiving_id, etc.). */
  disabled?: boolean;
  /** Remove a saved serial. Dropdown action on chips. */
  onDeleteSerial?: (serial: SavedSerial) => void;
  /**
   * Replace a saved serial with a new value. Called when the operator submits
   * the input while editing an existing chip — the parent should delete the
   * original and add the new one.
   */
  onReplaceSerial?: (original: SavedSerial, nextSerial: string) => void;
  /** PO-line notes — co-located here so operators see them while scanning. */
  notes?: string;
  /** Notes change handler (controlled). */
  onNotesChange?: (next: string) => void;
  /** Persist notes on blur. */
  onNotesBlur?: () => void;
  /** DOM id for the notes textarea (used by label). */
  notesId?: string;
}

/**
 * Top-of-workspace scan card. Hosts the everyday "scan a serial → ⏎" path
 * with the existing-serial chips rendered BELOW the input as `SerialChip`
 * copy-chips (last-4 display, emerald underline). Each chip exposes an
 * Edit / Delete dropdown on hover.
 *
 * Edit flow: clicking Edit populates the scan input with the chip's current
 * value and tracks it via local state. Submitting the input replaces the
 * original serial via `onReplaceSerial`. The X-clear button cancels the edit.
 */
export function SerialCard({
  saved,
  expected,
  onAdd,
  isSubmitting,
  disabled = false,
  onDeleteSerial,
  onReplaceSerial,
  notes,
  onNotesChange,
  onNotesBlur,
  notesId,
}: Props) {
  const showNotes = typeof notes === 'string' && typeof onNotesChange === 'function';
  const [scan, setScan] = useState('');
  const [editing, setEditing] = useState<SavedSerial | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const count = saved.length;
  const target = expected ?? 0;
  const isAtCap = target > 0 && count >= target;

  // If the underlying saved list changes while editing (e.g. the original
  // chip got deleted from elsewhere), clear the edit state so we don't try
  // to replace something that's gone.
  useEffect(() => {
    if (editing && !saved.some((s) => s.id === editing.id)) {
      setEditing(null);
      setScan('');
    }
  }, [saved, editing]);

  const tally = target > 0
    ? `${count}/${target} scanned`
    : `${count} scanned`;
  const tallyClass = isAtCap
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : count > 0
      ? 'bg-blue-50 text-blue-700 ring-blue-200'
      : 'bg-gray-50 text-gray-600 ring-gray-200';

  const beginEdit = (s: SavedSerial) => {
    setEditing(s);
    setScan(s.serial_number);
    // Defer focus until the input is enabled in the new render pass.
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
  };

  const cancelEdit = () => {
    setEditing(null);
    setScan('');
  };

  const submit = async () => {
    const trimmed = scan.trim();
    if (!trimmed || isSubmitting || disabled) return;

    if (editing) {
      // Replace mode — operator is finalizing an edit. Skip the comma-split
      // path since "editing one serial" is a single-value action.
      if (trimmed !== editing.serial_number && onReplaceSerial) {
        onReplaceSerial(editing, trimmed);
      }
      setEditing(null);
      setScan('');
      return;
    }

    // Allow comma-paste → submit each one in turn. AWAIT each onAdd so we
    // don't fan out concurrent requests — the receive-line writer uses a
    // SELECT FOR UPDATE lock that requires sequential calls, and parallel
    // submissions used to cause over-receive races (e.g. 2/1).
    const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    setScan('');
    for (const sn of parts) {
      try {
        await onAdd(sn);
      } catch {
        /* Parent handles toasts on its own; keep the loop going. */
      }
    }
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

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Barcode
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={scan}
            disabled={disabled || isSubmitting}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && editing) {
                e.preventDefault();
                cancelEdit();
              }
            }}
            placeholder={
              editing
                ? `Editing serial — press Enter to save, Esc to cancel`
                : isAtCap
                  ? 'All expected scanned — add more if needed'
                  : 'Scan or type a serial → ⏎'
            }
            autoComplete="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- scan-focused workflow
            autoFocus
            className={`block h-11 w-full rounded-xl border bg-white pl-9 pr-3 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
              editing
                ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500/30'
                : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/30'
            }`}
          />
          {scan || editing ? (
            <button
              type="button"
              onClick={() => (editing ? cancelEdit() : setScan(''))}
              aria-label={editing ? 'Cancel edit' : 'Clear input'}
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
          className={`inline-flex h-11 items-center justify-center rounded-xl px-4 text-[12px] font-black uppercase tracking-wider text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 ${
            editing
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isSubmitting ? 'Saving…' : editing ? 'Save' : 'Add'}
        </button>
      </div>

      {/* Saved serials — rendered BELOW the input as emerald copy-chips.
          Each chip exposes Edit / Delete actions in a small hover dropdown;
          the chip itself still click-to-copies via SerialChip. */}
      {count > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {saved.map((s, idx) => {
            const sn = (s.serial_number || '').trim();
            if (!sn) return null;
            const isEditingThis = editing?.id === s.id;
            return (
              <SerialChipWithMenu
                key={s.id ?? `${sn}-${idx}`}
                serial={s}
                isEditing={isEditingThis}
                onEdit={onReplaceSerial ? beginEdit : undefined}
                onDelete={onDeleteSerial}
              />
            );
          })}
        </div>
      ) : null}

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

/**
 * SerialChip wrapped with a hover dropdown menu (Edit / Delete). Click the
 * chip body to copy — same as a bare SerialChip — but hovering reveals a
 * small floating menu with two rows of actions.
 */
function SerialChipWithMenu({
  serial,
  isEditing,
  onEdit,
  onDelete,
}: {
  serial: SavedSerial;
  isEditing: boolean;
  onEdit?: (s: SavedSerial) => void;
  onDelete?: (s: SavedSerial) => void;
}) {
  const sn = serial.serial_number;
  const hasActions = !!(onEdit || onDelete);

  return (
    <div className="group relative inline-flex">
      <div
        className={`inline-flex rounded-md transition-colors ${
          isEditing ? 'ring-2 ring-amber-400 ring-offset-1' : ''
        }`}
      >
        <SerialChip
          value={sn}
          display={sn.length > 4 ? sn.slice(-4) : sn}
          width="w-fit max-w-full"
        />
      </div>
      {hasActions ? (
        // Outer wrapper holds the chip-to-menu gap as transparent padding so
        // the hover region is contiguous — moving the cursor from the chip
        // down into the dropdown doesn't cross a dead zone and dismiss it.
        <div
          className="invisible pointer-events-none absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        >
          <div
            role="menu"
            aria-label="Serial actions"
            className="min-w-[112px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            {onEdit ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => onEdit(serial)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest text-gray-700 hover:bg-gray-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0 text-gray-500">
                  <path d="M12 20h9" strokeLinecap="round" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinejoin="round" />
                </svg>
                Edit
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => onDelete(serial)}
                className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest text-rose-600 hover:bg-rose-50"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
