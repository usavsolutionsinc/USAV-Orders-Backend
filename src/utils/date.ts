const PST_TIME_ZONE = 'America/Los_Angeles';

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_NAIVE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const ISO_NAIVE_FRACTION_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\.\d+$/;
const SLASH_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
const TZ_SUFFIX_RE = /(Z|[+-]\d{2}:\d{2})$/i;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getPstYmdFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

export function getCurrentPSTTime(): Date {
  return new Date();
}

export function formatPSTTimestamp(date?: Date): string {
  const base = date ?? new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(base);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const second = parts.find((part) => part.type === 'second')?.value;

  if (!year || !month || !day || !hour || !minute || !second) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: PST_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(base).replace(',', '');
  }

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function formatApiInstant(date?: Date): string {
  const base = date ?? new Date();
  const shifted = new Date(base.getTime() + base.getTimezoneOffset() * 60_000);
  const year = shifted.getFullYear();
  const month = pad2(shifted.getMonth() + 1);
  const day = pad2(shifted.getDate());
  const hour = pad2(shifted.getHours());
  const minute = pad2(shifted.getMinutes());
  const second = pad2(shifted.getSeconds());
  const millisecond = String(shifted.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
}

export function formatApiOffsetTimestamp(date?: Date): string {
  return formatApiInstant(date).replace(/\.\d{3}Z$/, '+0000');
}

export function normalizePSTTimestamp(
  input: string | Date | null | undefined,
  options?: { fallbackToNow?: boolean }
): string | null {
  const fallbackToNow = options?.fallbackToNow ?? false;
  if (input == null || input === '') {
    return fallbackToNow ? formatPSTTimestamp() : null;
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return fallbackToNow ? formatPSTTimestamp() : null;
    return formatPSTTimestamp(input);
  }

  const raw = String(input).trim();
  if (!raw || raw === '1') return fallbackToNow ? formatPSTTimestamp() : null;

  if (ISO_DATE_ONLY_RE.test(raw)) return `${raw} 00:00:00`;

  if (SLASH_DATE_RE.test(raw)) {
    const [datePart, timePart] = raw.replace(',', '').split(/\s+/, 2);
    const [month, day, year] = datePart.split('/').map(Number);
    if (!month || !day || !year) return fallbackToNow ? formatPSTTimestamp() : null;
    const [hh = '00', mm = '00', ss = '00'] = (timePart || '00:00:00').split(':');
    return `${year}-${pad2(month)}-${pad2(day)} ${pad2(Number(hh))}:${pad2(Number(mm))}:${pad2(Number(ss))}`;
  }

  if ((ISO_NAIVE_RE.test(raw) || ISO_NAIVE_FRACTION_RE.test(raw)) && !TZ_SUFFIX_RE.test(raw)) {
    const normalized = raw.replace('T', ' ');
    const [datePart, timePartRaw] = normalized.split(' ');
    const timePart = (timePartRaw || '00:00:00').split('.')[0];
    const [hh = '00', mm = '00', ss = '00'] = timePart.split(':');
    return `${datePart} ${pad2(Number(hh))}:${pad2(Number(mm))}:${pad2(Number(ss))}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallbackToNow ? formatPSTTimestamp() : null;
  return formatPSTTimestamp(parsed);
}

export function toISOStringPST(timestamp: string): string {
  try {
    if (timestamp && timestamp.includes('/')) {
      const [datePart, timePart] = timestamp.split(' ');
      const [month, day, year] = datePart.split('/');
      const date = new Date(
        `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart || '00:00:00'}`
      );

      return date
        .toLocaleString('en-US', {
          timeZone: PST_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        })
        .replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6');
    }

    return timestamp;
  } catch (error) {
    console.error('Error converting timestamp to ISO PST:', error);
    return timestamp;
  }
}

export function getCurrentPSTDateKey(): string {
  return getPstYmdFromDate(new Date());
}

export function toPSTDateKey(input: string | Date | null | undefined): string {
  if (!input) return '';

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? '' : getPstYmdFromDate(input);
  }

  const raw = String(input).trim();
  if (!raw || raw === '1') return '';

  if (ISO_DATE_ONLY_RE.test(raw)) return raw;

  if (SLASH_DATE_RE.test(raw)) {
    const [datePart] = raw.split(' ');
    const [month, day, year] = datePart.split('/').map(Number);
    if (!month || !day || !year) return '';
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  if ((ISO_NAIVE_RE.test(raw) || ISO_NAIVE_FRACTION_RE.test(raw)) && !TZ_SUFFIX_RE.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return getPstYmdFromDate(parsed);
}

export function formatDateTimePST(input: string | Date | null | undefined): string {
  if (!input) return 'N/A';

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return 'N/A';
    return input
      .toLocaleString('en-US', {
        timeZone: PST_TIME_ZONE,
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
      .replace(',', '');
  }

  const raw = String(input).trim();
  if (!raw || raw === '1') return 'N/A';

  if (SLASH_DATE_RE.test(raw)) {
    const [datePart, timePart] = raw.split(/\s+/, 2);
    const [month, day, year] = datePart.split('/').map(Number);
    if (!month || !day || !year) return 'N/A';

    const [h = '00', m = '00', s = '00'] = (timePart || '00:00:00').split(':');
    return `${pad2(month)}/${pad2(day)}/${year} ${pad2(Number(h))}:${pad2(Number(m))}:${pad2(Number(s))}`;
  }

  if (ISO_DATE_ONLY_RE.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return `${pad2(month)}/${pad2(day)}/${year} 00:00:00`;
  }

  if ((ISO_NAIVE_RE.test(raw) || ISO_NAIVE_FRACTION_RE.test(raw)) && !TZ_SUFFIX_RE.test(raw)) {
    const normalized = raw.replace(' ', 'T');
    const [datePart, timePartRaw] = normalized.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const timePart = (timePartRaw || '00:00:00').split('.')[0];
    const [hh = '00', mm = '00', ss = '00'] = timePart.split(':');
    return `${pad2(month)}/${pad2(day)}/${year} ${pad2(Number(hh))}:${pad2(Number(mm))}:${pad2(Number(ss))}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  return parsed
    .toLocaleString('en-US', {
      timeZone: PST_TIME_ZONE,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    .replace(',', '');
}

export function formatDatePST(
  input: string | Date | null | undefined,
  options?: { shortYear?: boolean; withLeadingZeros?: boolean }
): string {
  if (!input) return 'N/A';
  const dateKey = toPSTDateKey(input);
  if (!dateKey) return 'N/A';

  const [yearRaw, monthRaw, dayRaw] = dateKey.split('-').map(Number);
  const shortYear = options?.shortYear ?? false;
  const withLeadingZeros = options?.withLeadingZeros ?? false;
  const month = withLeadingZeros ? pad2(monthRaw) : String(monthRaw);
  const day = withLeadingZeros ? pad2(dayRaw) : String(dayRaw);
  const year = shortYear ? String(yearRaw).slice(-2) : String(yearRaw);

  return `${month}/${day}/${year}`;
}

export function formatTimePST(
  input: string | Date | null | undefined,
  options?: { withSeconds?: boolean }
): string {
  if (!input) return '--:--';
  const withSeconds = options?.withSeconds ?? false;
  const full = formatDateTimePST(input);
  if (full === 'N/A') return '--:--';
  const timePart = full.split(' ')[1] || '';
  if (!timePart) return '--:--';
  return withSeconds ? timePart : timePart.split(':').slice(0, 2).join(':');
}

export function isSamePSTDate(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined
): boolean {
  const keyA = toPSTDateKey(a);
  const keyB = toPSTDateKey(b);
  return !!keyA && !!keyB && keyA === keyB;
}

export function formatDateWithOrdinal(dateStr: string): string {
  try {
    if (!dateStr) return 'Unknown';

    const getOrdinal = (value: number) => {
      const suffixes = ['th', 'st', 'nd', 'rd'];
      const mod100 = value % 100;
      return value + (suffixes[(mod100 - 20) % 10] || suffixes[mod100] || suffixes[0]);
    };

    let date: Date;
    const pstDateKey = toPSTDateKey(dateStr);
    if (pstDateKey) {
      const [year, month, day] = pstDateKey.split('-').map(Number);
      date = new Date(year, month - 1, day);
    } else if (ISO_DATE_ONLY_RE.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      date = new Date(year, month - 1, day);
    } else {
      date = new Date(dateStr);
    }

    if (Number.isNaN(date.getTime())) return dateStr;

    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${getOrdinal(date.getDate())}`;
  } catch {
    return dateStr;
  }
}

export function formatShortDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';

  try {
    const dateKey = toPSTDateKey(dateString);
    if (dateKey) {
      const [year, month, day] = dateKey.split('-').map(Number);
      return `${month}/${day}/${String(year).slice(-2)}`;
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Invalid Date';
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear().toString().slice(-2)}`;
  } catch {
    return 'Invalid Date';
  }
}

export function formatMonthDay(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const dateKey = toPSTDateKey(dateString);
  if (dateKey) {
    const [, month, day] = dateKey.split('-').map(Number);
    if (!month || !day) return null;
    return `${month}/${day}`;
  }
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  return `${month}/${day}`;
}

// ─── Days-late helpers ──────────────────────────────────────────────────────

/**
 * Returns how many days past the deadline (0 if not late or no date).
 * Accepts an optional fallback date (e.g. created_at when ship_by is missing).
 */
export function getDaysLateNumber(deadlineAt: string | null | undefined, fallbackDate?: string | null): number {
  const deadlineKey = toPSTDateKey(deadlineAt) || toPSTDateKey(fallbackDate);
  const todayKey = getCurrentPSTDateKey();
  if (!deadlineKey || !todayKey) return 0;
  const [dy, dm, dd] = deadlineKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const deadlineIndex = Math.floor(Date.UTC(dy, dm - 1, dd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - deadlineIndex);
}

/**
 * Same as getDaysLateNumber but returns null when no deadline is provided.
 * Useful when callers need to distinguish "no deadline" from "0 days late".
 */
export function getDaysLateNullable(deadlineAt: string | null | undefined): number | null {
  const deadlineKey = toPSTDateKey(deadlineAt);
  if (!deadlineKey) return null;
  const todayKey = getCurrentPSTDateKey();
  if (!todayKey) return null;
  const [dy, dm, dd] = deadlineKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const deadlineIndex = Math.floor(Date.UTC(dy, dm - 1, dd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - deadlineIndex);
}

/** Tailwind text-color class based on days late. Accepts null for "no deadline" styling. */
export function getDaysLateTone(daysLate: number | null): string {
  if (daysLate === null) return 'text-gray-500';
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

// ─── Week range helpers ─────────────────────────────────────────────────────

export interface WeekRange {
  start: Date;
  end: Date;
  startStr: string;
  endStr: string;
}

/** Compute Monday–Friday date range for a given week offset (0 = current week, 1 = last week, etc.). */
export function computeWeekRange(weekOffset: number): WeekRange {
  const todayPst = getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday - weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  return {
    start: monday,
    end: friday,
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}
