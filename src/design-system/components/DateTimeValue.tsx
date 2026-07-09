'use client';

import { formatDateTimePST } from '@/utils/date';

interface DateTimeValueProps {
  /** Raw timestamp (ISO / slash / Date). Formatted to PST `MM/DD/YYYY h:mm:ss AM/PM`. */
  value: string | Date | null | undefined;
  /** Shown when the value is empty / invalid. Default "N/A". */
  fallback?: string;
  className?: string;
}

/**
 * Canonical date+time value for details-panel ledgers — the single reusable way
 * to render a timestamp so a column of them lines up perfectly.
 *
 * Why a component (not just a formatted string): `formatDateTimePST` yields
 * `MM/DD/YYYY h:mm:ss AM/PM`, where the hour is 1–2 digits so the string width
 * varies by a character. This renders a single fixed-width cell split into two
 * columns: the DATE pinned left (so a stacked column of dates all start at the
 * same x) and the TIME filling the rest, right-aligned (so the times sit to the
 * right with their AM/PM edges flush). Tabular figures keep digits equal width.
 */
export function DateTimeValue({ value, fallback = 'N/A', className = '' }: DateTimeValueProps) {
  const formatted = formatDateTimePST(value ?? null);

  if (formatted === 'N/A') {
    return (
      <span
        className={`block w-56 shrink-0 whitespace-nowrap text-left text-sm font-bold tabular-nums text-text-faint ${className}`}
      >
        {fallback}
      </span>
    );
  }

  // "MM/DD/YYYY h:mm:ss AM/PM" → date (left) + time (right-aligned).
  const splitAt = formatted.indexOf(' ');
  const date = splitAt === -1 ? formatted : formatted.slice(0, splitAt);
  const time = splitAt === -1 ? '' : formatted.slice(splitAt + 1);

  return (
    <span
      className={`flex w-56 shrink-0 items-baseline gap-2 whitespace-nowrap text-sm font-bold tabular-nums text-text-default ${className}`}
    >
      <span>{date}</span>
      {time ? <span className="flex-1 text-right">{time}</span> : null}
    </span>
  );
}
