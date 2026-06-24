'use client';

import { Check, Loader2, X } from '@/components/Icons';

interface ShippedNotesComposerProps {
  value: string;
  onChange?: (value: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
  onClick?: () => void;
  isSaving?: boolean;
  readOnly?: boolean;
}

export function ShippedNotesComposer({
  value,
  onChange,
  onCancel,
  onSubmit,
  onClick,
  isSaving = false,
  readOnly = false,
}: ShippedNotesComposerProps) {
  return (
    <section className="mx-8 pt-2">
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <span className="pointer-events-none absolute left-4 top-2 z-10 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Notes
        </span>
        {readOnly ? (
          <button
            type="button"
            onClick={onClick}
            className="block w-full rounded-2xl px-4 pb-3 pt-7 text-left transition hover:bg-slate-50"
            aria-label="Edit note"
            title="Click to edit"
          >
            <div className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">
              {value}
            </div>
          </button>
        ) : (
          <>
            <textarea
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              rows={4}
              placeholder="Add a note for this order"
              className="min-h-[108px] w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 pb-3 pt-7 text-sm font-medium leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
              autoFocus
            />
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Cancel note"
                title="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={isSaving}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={isSaving ? 'Saving note' : 'Save note'}
                title={isSaving ? 'Saving' : 'Save'}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
