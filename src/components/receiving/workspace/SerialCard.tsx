'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Pencil } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SerialChip } from '@/components/ui/CopyChip';
import { TextField, IconButton } from '@/design-system/primitives';
import { ConditionPills } from './ConditionPills';
import { ConditionBadge } from './ReceivingUnitRows';

interface SavedSerial {
  id?: number;
  serial_number: string;
  condition_grade?: string | null;
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
  /** Optional condition picker integrated into the scan row. */
  condition?: string | null | undefined;
  onConditionChange?: (grade: string) => void;
  /**
   * When the serial input is empty, show a green check in place of the disabled
   * "+" so the operator can mark the item as having no serial number. Omitted →
   * the trailing control is the normal add-"+" button only.
   */
  onMarkNoSerial?: () => void;
  /** Render the no-serial check as active (solid green) while the waiver is set. */
  noSerialActive?: boolean;
  /**
   * Rendered IN the serial-input position (replacing the field) while the
   * no-serial waiver is active — a contextual form swap on the same row, not a
   * second row underneath.
   */
  noSerialSlot?: ReactNode;
  /** PO-line notes — co-located here so operators see them while scanning. */
  notes?: string;
  /** Notes change handler (controlled). */
  onNotesChange?: (next: string) => void;
  /** Persist notes when focus leaves (e.g. clicking outside the field). */
  onNotesBlur?: () => void;
  /** DOM id for the notes textarea (used by label). */
  notesId?: string;
  /** When false, chips stay in the PO header only (no duplicate list below input). */
  showSavedChips?: boolean;
  /**
   * Slot rendered directly under the SERIAL input row (above any saved chips).
   * Used by the RETURN flow to show the serial-match result inline with the
   * scan field.
   */
  resultSlot?: ReactNode;
  /** Nested inside {@link PoLinesAccordion} — skip duplicate card chrome. */
  embedded?: boolean;
  /** Controlled edit target from the PO item header chip. */
  editingSerial?: SavedSerial | null;
  onEditingSerialChange?: (serial: SavedSerial | null) => void;
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
  onAdd,
  isSubmitting,
  disabled = false,
  onDeleteSerial,
  onReplaceSerial,
  condition,
  onConditionChange,
  onMarkNoSerial,
  noSerialActive = false,
  noSerialSlot,
  notes,
  onNotesChange,
  onNotesBlur,
  notesId,
  showSavedChips = true,
  embedded = false,
  editingSerial = null,
  onEditingSerialChange,
  resultSlot,
}: Props) {
  const showNotes = typeof notes === 'string' && typeof onNotesChange === 'function';
  const [scan, setScan] = useState('');
  const [editing, setEditing] = useState<SavedSerial | null>(null);
  // Condition picker expand/collapse — starts expanded for selection, collapses
  // to the chosen pill once a grade is picked or while a serial is being edited.
  const [condExpanded, setCondExpanded] = useState(true);
  /** Avoid flashing “Saving…” on fast round-trips; only shown if submit hangs ~400ms+ */
  const [showSavingLabel, setShowSavingLabel] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const count = saved.length;

  /**
   * Pick a condition grade, then jump focus straight to the serial input so
   * the operator can scan without a second click. Deferred a tick so focus
   * lands after the grade-change re-render (input is enabled by then).
   */
  const handleConditionPick = (grade: string) => {
    onConditionChange?.(grade);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el || el.disabled) return;
      el.focus();
    }, 0);
  };

  // If the underlying saved list changes while editing (e.g. the original
  // chip got deleted from elsewhere), clear the edit state so we don't try
  // to replace something that's gone.
  useEffect(() => {
    if (editing && !saved.some((s) => s.id === editing.id)) {
      setEditing(null);
      setScan('');
      onEditingSerialChange?.(null);
    }
  }, [saved, editing, onEditingSerialChange]);

  useEffect(() => {
    if (!editingSerial) {
      setEditing(null);
      return;
    }
    setEditing(editingSerial);
    setScan(editingSerial.serial_number);
    // Collapse the condition picker so the focus is on editing the serial text.
    setCondExpanded(false);
    const t = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [editingSerial]);

  useEffect(() => {
    if (!isSubmitting) {
      setShowSavingLabel(false);
      return;
    }
    const t = window.setTimeout(() => setShowSavingLabel(true), 420);
    return () => window.clearTimeout(t);
  }, [isSubmitting]);

  const beginEdit = (s: SavedSerial) => {
    setEditing(s);
    onEditingSerialChange?.(s);
    setScan(s.serial_number);
    // Collapse the condition picker so the focus is on editing the serial text.
    setCondExpanded(false);
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
    onEditingSerialChange?.(null);
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
      onEditingSerialChange?.(null);
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

  const Shell = embedded ? 'div' : 'section';
  const shellClass = embedded
    ? 'w-full group'
    : 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60 group';

  return (
    <Shell className={shellClass}>
      <div className="flex items-center gap-2">
        {onConditionChange ? (
          // Condition picker: full pill row when the line opens (for selection),
          // collapsing to the chosen pill + an edit pencil once a grade is
          // picked. Picking a grade auto-focuses the serial input below.
          <div className="flex min-w-0 items-center gap-2">
            <ConditionPills
              value={condition}
              onChange={handleConditionPick}
              collapsible
              expanded={condExpanded}
              onExpandedChange={setCondExpanded}
            />
            <div className="h-8 w-px shrink-0 bg-gray-100" />
          </div>
        ) : condition ? (
          <div className="shrink-0">
            <ConditionBadge grade={condition} />
          </div>
        ) : null}

        <div className="flex-1 min-w-0">
          {noSerialActive && noSerialSlot ? (
            noSerialSlot
          ) : (
          <TextField
            ref={inputRef}
            label="Serial"
            value={scan}
            onChange={setScan}
            tone={editing ? 'emerald' : 'blue'}
            mono
            disabled={disabled || isSubmitting}
            autoComplete="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- scan-focused workflow
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && editing) {
                e.preventDefault();
                cancelEdit();
              }
            }}
            trailing={
              scan || editing ? (
                <IconButton
                  onClick={() => (editing ? cancelEdit() : setScan(''))}
                  ariaLabel={editing ? 'Cancel edit' : 'Clear input'}
                  className="rounded-md p-1 hover:bg-gray-100"
                  icon={<X className="h-3.5 w-3.5" />}
                />
              ) : undefined
            }
          />
          )}
        </div>

        {/* Trailing action. While the waiver is ACTIVE the full-width no-serial bar
            (rendered in the field slot above) owns the row and carries its own
            clear (✕) — so no trailing control here, no redundant confirm. When the
            field is empty, a QUIET no-serial offer affordance (secondary, not a
            second green CTA). Otherwise the "+" add / Save submit. */}
        {noSerialActive ? null : !scan.trim() && !editing && onMarkNoSerial ? (
          <HoverTooltip label="Mark this item as having no serial number" asChild>
            {/* ds-raw-button: green-check no-serial offer toggle, not a DS Button */}
            <button
              type="button"
              onClick={onMarkNoSerial}
              aria-label="Mark this item as having no serial number"
              className="inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-600 shadow-sm transition-colors hover:bg-emerald-100"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-5 w-5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </HoverTooltip>
        ) : (
          /* ds-raw-button: solid-emerald scan-submit CTA with add-glyph / Saving… text-swap */
          <button
            type="button"
            onClick={submit}
            disabled={!scan.trim() || isSubmitting || disabled}
            className={`inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-label font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300 ${
              editing || (showSavingLabel && isSubmitting) ? 'px-4' : 'w-14'
            }`}
          >
            {showSavingLabel && isSubmitting ? (
              'Saving…'
            ) : editing ? (
              'Save'
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-5 w-5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Inline slot directly under the scan field — the RETURN flow renders
          its serial-match result here (found / not found). */}
      {resultSlot ? <div className="mt-3">{resultSlot}</div> : null}

      {/* Saved serials — rendered BELOW the input as emerald copy-chips.
          Each chip exposes Edit / Delete in a hover menu below the chip;
          click the chip body to copy (SerialChip). */}
      {showSavedChips && count > 0 ? (
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
            className="block text-micro font-bold uppercase tracking-[0.14em] text-gray-500"
          >
            Notes
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => onNotesChange?.(e.target.value)}
            onBlur={onNotesBlur}
            rows={2}
            placeholder="PO-line notes (saved on off click)"
            className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-label font-medium leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      ) : null}
    </Shell>
  );
}

/**
 * {@link SerialChip} wrapped with a hover menu (Edit / Delete) positioned below
 * the chip. Click the chip to copy; hover to reveal actions.
 *
 * Wired from {@link PoLinesAccordion} when `LineEditPanel` passes
 * `activeSerialActions`, and reused by SerialCard / InlineSerialAdder chip lists.
 */
export function SerialChipWithMenu({
  serial,
  isEditing,
  onEdit,
  onDelete,
  onSetCondition,
}: {
  serial: SavedSerial;
  isEditing: boolean;
  onEdit?: (s: SavedSerial) => void;
  onDelete?: (s: SavedSerial) => void;
  /** When provided, the hover menu includes a condition picker for this serial. */
  onSetCondition?: (s: SavedSerial, grade: string) => void;
}) {
  const sn = serial.serial_number;
  const hasActions = !!(onEdit || onDelete || onSetCondition);
  const [menuHover, setMenuHover] = useState(false);

  return (
    <div
      className="group relative inline-flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseEnter={() => {
        if (hasActions) setMenuHover(true);
      }}
      onMouseLeave={() => setMenuHover(false)}
    >
      <div
        className={`inline-flex items-center gap-1 rounded-md transition-colors ${
          isEditing ? 'ring-2 ring-emerald-400 ring-offset-1' : ''
        }`}
      >
        <SerialChip value={sn} width="w-fit max-w-full" />
      </div>
      {hasActions ? (
        <div
          // Intentional exception (memory: z-index-scale-sot): a purely in-flow
          // CSS hover tooltip stacking within this card's local context — not
          // part of the global portal/overlay system, so it stays a raw z-[100].
          // Hover-only — focus-within kept menus stuck after chip click.
          // eslint-disable-next-line no-restricted-syntax
          className={`absolute left-1/2 top-full z-[100] -translate-x-1/2 pt-1 transition-opacity duration-100 ${
            menuHover
              ? 'visible pointer-events-auto opacity-100'
              : 'invisible pointer-events-none opacity-0'
          }`}
        >
          <div
            role="menu"
            aria-label="Serial actions"
            className={`overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ${onSetCondition ? 'min-w-[200px]' : 'min-w-[112px]'}`}
          >
            {onSetCondition ? (
              <div className="border-b border-gray-100 px-2 py-1.5">
                <p className="mb-1 text-micro font-bold uppercase tracking-widest text-gray-400">
                  Condition
                </p>
                <ConditionPills
                  value={serial.condition_grade}
                  onChange={(next) => onSetCondition(serial, next)}
                />
              </div>
            ) : null}
            {onEdit ? (
              // ds-raw-button: role=menuitem text-left dropdown action row, not a standalone DS Button
              <button
                type="button"
                role="menuitem"
                onClick={() => onEdit(serial)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption font-bold uppercase tracking-widest text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                Edit
              </button>
            ) : null}
            {onDelete ? (
              // ds-raw-button: role=menuitem text-left dropdown action row, not a standalone DS Button
              <button
                type="button"
                role="menuitem"
                onClick={() => onDelete(serial)}
                className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-caption font-bold uppercase tracking-widest text-rose-600 hover:bg-rose-50"
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
