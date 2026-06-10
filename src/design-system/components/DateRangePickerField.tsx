'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { Calendar as CalendarPicker } from './Calendar';
import { Calendar as CalendarIcon, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';

export interface DateRangePickerFieldProps {
  /** Current value. `undefined` = nothing picked yet. `{from, to: undefined}` = first endpoint only. */
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;
  /** Trigger button label when no range is set. */
  placeholder?: string;
  /** Disable the whole control. */
  disabled?: boolean;
  /** Optional shortcut chips below the calendar (Today / Last 7 days / Last 30). */
  presets?: ReadonlyArray<{ label: string; range: () => DateRange }>;
  /** Earliest selectable day. */
  fromDate?: Date;
  /** Latest selectable day. */
  toDate?: Date;
  /** Extra classes on the trigger button. */
  className?: string;
}

const DEFAULT_PRESETS: ReadonlyArray<{ label: string; range: () => DateRange }> = [
  {
    label: 'Today',
    range: () => {
      const d = new Date();
      return { from: d, to: d };
    },
  },
  {
    label: 'Last 7 days',
    range: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 6);
      return { from, to };
    },
  },
  {
    label: 'Last 30 days',
    range: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 29);
      return { from, to };
    },
  },
  {
    label: 'This month',
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to: now };
    },
  },
];

/**
 * Trigger-button + Radix Popover + react-day-picker range mode. Drop-in
 * replacement for `<input type="date">` pairs when the operator picks a
 * date range to filter by. Owns no application state — fully controlled
 * via {@link DateRangePickerFieldProps.value} + onChange.
 *
 * Layout (popover open):
 *   ┌──────────────────────────────┐
 *   │ Today | 7 days | 30d | Month │  presets row
 *   ├──────────────────────────────┤
 *   │      [ inline calendar ]      │  react-day-picker, range mode
 *   ├──────────────────────────────┤
 *   │       Clear        Apply      │  footer
 *   └──────────────────────────────┘
 */
export function DateRangePickerField({
  value,
  onChange,
  placeholder = 'Pick a date range',
  disabled = false,
  presets = DEFAULT_PRESETS,
  fromDate,
  toDate,
  className,
}: DateRangePickerFieldProps) {
  const [open, setOpen] = useState(false);
  // Local working copy — only commits to parent on "Apply" or preset click
  // so a half-picked range doesn't fire useEffect chains on every click.
  const [draft, setDraft] = useState<DateRange | undefined>(value);

  // Sync draft when the popover opens (parent may have changed value).
  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(value);
    setOpen(next);
  };

  const hasValue = Boolean(value?.from);
  const label = (() => {
    if (!value?.from) return placeholder;
    const from = format(value.from, 'MMM d, yyyy');
    if (!value.to || value.to.getTime() === value.from.getTime()) return from;
    const to = format(value.to, 'MMM d, yyyy');
    return `${from} → ${to}`;
  })();

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex h-9 w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 text-left text-caption font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50',
            hasValue ? 'text-slate-900' : 'text-slate-400',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="flex-1 truncate">{label}</span>
          {hasValue ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(undefined);
                setDraft(undefined);
              }}
              aria-label="Clear date range"
              className="-mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-dropdown rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          {presets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 p-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const r = p.range();
                    setDraft(r);
                    onChange(r);
                    setOpen(false);
                  }}
                  className="rounded-md px-2 py-1 text-eyebrow font-black uppercase tracking-wider text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          <CalendarPicker
            mode="range"
            selected={draft}
            onSelect={setDraft}
            numberOfMonths={1}
            defaultMonth={draft?.from ?? new Date()}
            disabled={
              fromDate || toDate
                ? { before: fromDate ?? new Date(0), after: toDate ?? new Date(8.64e15) }
                : undefined
            }
          />

          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setDraft(undefined);
                onChange(undefined);
                setOpen(false);
              }}
              className="text-eyebrow font-black uppercase tracking-wider text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              disabled={!draft?.from}
              className="rounded-md bg-blue-600 px-3 py-1 text-caption font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Apply
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
