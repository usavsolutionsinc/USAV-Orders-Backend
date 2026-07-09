'use client';

import { DayPicker, type DayPickerProps } from 'react-day-picker';
import 'react-day-picker/style.css';
import { cn } from '@/utils/_cn';
import { ChevronLeft, ChevronRight } from '@/components/Icons';

/**
 * Tailwind-styled wrapper around react-day-picker (v10). Re-themed so the
 * calendar matches the rest of the design system (slate text, blue accent,
 * compact cells, sans typography). Uses the library's `classNames` prop to
 * override the default class on every internal element; no global CSS
 * override file required.
 *
 * Consumers should mount this inside a Popover or Sheet — it does not own
 * its own visibility. {@link DateRangePickerField} is the typical entry
 * point for forms.
 */
export type CalendarProps = DayPickerProps & { className?: string };

export function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-3',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-semibold text-text-default',
        nav: 'flex items-center justify-between absolute inset-x-1 top-1',
        button_previous:
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-text-default transition-colors',
        button_next:
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken hover:text-text-default transition-colors',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday:
          'w-9 text-eyebrow font-black uppercase tracking-wider text-text-faint rounded-md',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-blue-50 hover:text-blue-700 transition-colors aria-selected:bg-blue-600 aria-selected:text-white aria-selected:hover:bg-blue-700',
        range_start:
          'rounded-l-md bg-blue-100 [&_button]:bg-blue-600 [&_button]:text-white',
        range_end:
          'rounded-r-md bg-blue-100 [&_button]:bg-blue-600 [&_button]:text-white',
        range_middle:
          'bg-blue-50 text-blue-700 [&_button]:hover:bg-blue-100',
        today:
          '[&_button]:font-bold [&_button]:ring-1 [&_button]:ring-inset [&_button]:ring-blue-200',
        outside: 'opacity-40',
        disabled: 'opacity-30 pointer-events-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" {...rest} />
          ) : (
            <ChevronRight className="h-4 w-4" {...rest} />
          ),
      }}
      {...props}
    />
  );
}
