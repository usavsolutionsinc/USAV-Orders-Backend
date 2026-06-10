'use client';

import { useState, type MouseEvent } from 'react';
import { format } from 'date-fns';
import * as Popover from '@radix-ui/react-popover';
import { Calendar as CalendarPicker } from '@/design-system/components/Calendar';
import { Calendar as CalendarIcon, Printer, ChevronDown, Loader2 } from '@/components/Icons';
import { printPickupReportForDate } from '@/lib/shipped/printPickupReportForDate';
import { cn } from '@/utils/_cn';

interface PickupReportButtonProps {
  className?: string;
  /** PST date key (yyyy-mm-dd) the calendar opens on. Defaults to today. */
  defaultDateKey?: string;
}

/**
 * Header control for the Shipped tab: opens a calendar, and printing the daily
 * carrier pickup report for whichever day is picked. The report is fetched
 * fresh for that day (all carriers, customer + FBA) so it is accurate
 * regardless of the table's current filter.
 */
export function PickupReportButton({ className, defaultDateKey }: PickupReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaultMonth = defaultDateKey ? new Date(`${defaultDateKey}T00:00:00`) : new Date();

  const handlePick = async (date: Date | undefined) => {
    if (!date || busy) return;
    const dateKey = format(date, 'yyyy-MM-dd');
    setOpen(false);
    setBusy(true);
    try {
      await printPickupReportForDate(dateKey);
    } catch (err) {
      console.warn('PickupReportButton: print failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label="Print shipped report"
          // Plain template literal (not cn/twMerge): the app's custom `text-label`
          // font-size utility is misread by tailwind-merge as a text color and
          // gets dropped when merged alongside `text-gray-700`, which would leave
          // the button at the larger base size. Matches the Filters/Zoho buttons.
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-label font-bold text-gray-700 ring-1 ring-inset ring-gray-200 transition-colors hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ''}`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
          ) : (
            <Printer className="h-4 w-4 shrink-0 text-gray-500" />
          )}
          <span className="flex-1 text-left">Shipped Report</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open ? 'rotate-180' : '')}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-dropdown rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-eyebrow font-black uppercase tracking-wider text-slate-500">
            <CalendarIcon className="h-3.5 w-3.5 text-slate-400" />
            Pick a date
          </div>
          <CalendarPicker
            mode="single"
            onSelect={handlePick}
            defaultMonth={defaultMonth}
            disabled={{ after: new Date() }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface DayPickupPrintButtonProps {
  /** PST date key (yyyy-mm-dd) for the day to print. */
  dateKey: string;
  className?: string;
}

/**
 * Compact per-day print button shown in a Shipped day-group header. Prints the
 * carrier pickup report for that exact day.
 */
export function DayPickupPrintButton({ dateKey, className }: DayPickupPrintButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await printPickupReportForDate(dateKey);
    } catch (err) {
      console.warn('DayPickupPrintButton: print failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Print this day's shipped report"
      aria-label="Print this day's shipped report"
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60',
        className,
      )}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : <Printer className="h-3.5 w-3.5" />}
    </button>
  );
}
