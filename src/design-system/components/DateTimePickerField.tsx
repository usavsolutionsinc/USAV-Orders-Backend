'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { format } from 'date-fns';
import { Calendar as CalendarPicker } from './Calendar';
import { Calendar as CalendarIcon } from '@/components/Icons';
import { cn } from '@/utils/_cn';

interface DateTimePickerFieldProps {
  /** Current value. `undefined` = nothing picked yet. */
  value: Date | undefined;
  onChange: (next: Date) => void;
  /** Trigger button label when no value is set. */
  placeholder?: string;
  /** Disable the whole control. */
  disabled?: boolean;
  /** Earliest selectable day. */
  fromDate?: Date;
  /** Latest selectable day. */
  toDate?: Date;
  /** Extra classes on the trigger button. */
  className?: string;
  /** Accent the trigger to match its host surface (emerald for mark-as-shipped). */
  tone?: 'default' | 'emerald';
}

const TONE_TRIGGER: Record<NonNullable<DateTimePickerFieldProps['tone']>, string> = {
  default:
    'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 focus:border-blue-500 focus:ring-blue-500/20',
  emerald:
    'border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 focus:border-emerald-500 focus:ring-emerald-500/20',
};

function toTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Trigger-button + Radix Popover + the design-system {@link CalendarPicker}
 * (react-day-picker, single mode) paired with a time input. The single-date
 * sibling of {@link DateRangePickerField} — use it anywhere an operator needs
 * to pick a specific day *and* time (e.g. the "mark as shipped" packed-at
 * stamp) instead of a raw `<input type="datetime-local">`.
 *
 * Owns no application state beyond the open flag; fully controlled via
 * `value` + `onChange`. Picking a new day preserves the current time-of-day;
 * the time input edits hours/minutes on the selected day.
 */
export function DateTimePickerField({
  value,
  onChange,
  placeholder = 'Pick a date & time',
  disabled = false,
  fromDate,
  toDate,
  className,
  tone = 'default',
}: DateTimePickerFieldProps) {
  const [open, setOpen] = useState(false);

  const hasValue = Boolean(value);
  const label = value ? format(value, 'MMM d, yyyy · h:mm a') : placeholder;
  const timeValue = value ? toTimeInputValue(value) : '';

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) return;
    const base = value ?? new Date();
    const next = new Date(day);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    onChange(next);
  };

  const handleTimeChange = (raw: string) => {
    if (!raw) return;
    const [h, m] = raw.split(':').map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const next = new Date(value ?? new Date());
    next.setHours(h, m, 0, 0);
    onChange(next);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex h-8 w-full items-center gap-2 rounded-lg border bg-white px-2.5 text-left text-micro font-bold transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
            TONE_TRIGGER[tone],
            hasValue ? 'text-gray-900' : 'text-gray-400',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="flex-1 truncate">{label}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-dropdown rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <CalendarPicker
            mode="single"
            selected={value}
            onSelect={handleDaySelect}
            numberOfMonths={1}
            defaultMonth={value ?? new Date()}
            disabled={
              fromDate || toDate
                ? { before: fromDate ?? new Date(0), after: toDate ?? new Date(8.64e15) }
                : undefined
            }
          />

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2">
            <label className="flex items-center gap-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">
              Time
              <input
                type="time"
                value={timeValue}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-micro font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-blue-600 px-3 py-1 text-caption font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
