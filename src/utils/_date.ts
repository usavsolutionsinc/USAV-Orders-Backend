/**
 * Generic date formatting utilities.
 * For PST-specific formatting, use the dedicated PST functions in `./date.ts`.
 */

/**
 * Formats a date as a human-readable string using Intl.DateTimeFormat.
 * @example formatDate(new Date()) → 'March 18, 2026'
 */
export function formatDate(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
  locale = 'en-US',
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}

/**
 * Returns a relative time string.
 * @example timeAgo(Date.now() - 60000) → '1 minute ago'
 */
export function timeAgo(date: Date | string | number): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const intervals: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  for (const [secs, label] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count} ${label}${count !== 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

/**
 * Returns an ISO date string (YYYY-MM-DD) for a given date.
 */
export function toISODate(date: Date | string | number): string {
  return new Date(date).toISOString().split('T')[0];
}

/**
 * Returns true if the given date falls on today (UTC).
 */
export function isToday(date: Date | string | number): boolean {
  return toISODate(date) === toISODate(Date.now());
}

/**
 * Adds a number of days to a date and returns the new Date.
 */
export function addDays(date: Date | string | number, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Returns the start of the day (00:00:00.000) for a given date.
 */
export function startOfDay(date: Date | string | number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the end of the day (23:59:59.999) for a given date.
 */
export function endOfDay(date: Date | string | number): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
