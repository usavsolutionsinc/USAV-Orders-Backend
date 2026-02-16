/**
 * Timezone utilities for PST/PDT (America/Los_Angeles)
 */
const PST_TIME_ZONE = 'America/Los_Angeles';

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_NAIVE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
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

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

/**
 * Get current timestamp in PST/PDT timezone
 * @returns Date object representing current time in PST/PDT
 */
export function getCurrentPSTTime(): Date {
  // Create date in PST timezone
  const pstDate = new Date(new Date().toLocaleString('en-US', { timeZone: PST_TIME_ZONE }));
  return pstDate;
}

/**
 * Format a date as MM/DD/YYYY HH:mm:ss in PST timezone
 * @param date Optional date to format (defaults to current PST time)
 * @returns Formatted date string in PST
 */
export function formatPSTTimestamp(date?: Date): string {
  const pstDate = date || getCurrentPSTTime();
  
  // Ensure the date is interpreted in PST
  const pstString = pstDate.toLocaleString('en-US', { 
    timeZone: PST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse the localized string to get individual components
  const [datePart, timePart] = pstString.split(', ');
  const [month, day, year] = datePart.split('/');
  
  return `${month}/${day}/${year} ${timePart}`;
}

/**
 * Convert a timestamp string to ISO format in PST timezone
 * @param timestamp Timestamp string in MM/DD/YYYY HH:mm:ss format
 * @returns ISO string in PST timezone
 */
export function toISOStringPST(timestamp: string): string {
  try {
    if (timestamp && timestamp.includes('/')) {
      const [datePart, timePart] = timestamp.split(' ');
      const [m, d, y] = datePart.split('/');
      
      // Create date as PST by using toLocaleString with timezone
      const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`);
      
      // Convert to PST ISO string
      return date.toLocaleString('en-US', { 
        timeZone: PST_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6');
    }
    return timestamp;
  } catch (e) {
    console.error('Error converting timestamp to ISO PST:', e);
    return timestamp;
  }
}

/**
 * Get current date key (YYYY-MM-DD) in PST/PDT.
 */
export function getCurrentPSTDateKey(): string {
  return getPstYmdFromDate(new Date());
}

/**
 * Convert an input date/timestamp to a YYYY-MM-DD key in PST/PDT.
 * Handles slash-format and timezone-naive ISO timestamps as PST wall time.
 */
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

  if (ISO_NAIVE_RE.test(raw) && !TZ_SUFFIX_RE.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return getPstYmdFromDate(parsed);
}

/**
 * Format input as MM/DD/YYYY HH:mm:ss in PST/PDT.
 * Treats slash-format and timezone-naive ISO timestamps as PST wall time.
 */
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
        hour12: false,
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

  if (ISO_NAIVE_RE.test(raw) && !TZ_SUFFIX_RE.test(raw)) {
    const normalized = raw.replace(' ', 'T');
    const [datePart, timePartRaw] = normalized.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hh = '00', mm = '00', ss = '00'] = (timePartRaw || '00:00:00').split(':');
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
      hour12: false,
    })
    .replace(',', '');
}

/**
 * Format input as date in PST/PDT.
 */
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

/**
 * Format input as HH:mm (24-hour) or HH:mm:ss in PST/PDT.
 */
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
  if (withSeconds) return timePart;
  return timePart.split(':').slice(0, 2).join(':');
}

/**
 * Compare whether two timestamps fall on the same PST/PDT calendar day.
 */
export function isSamePSTDate(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined
): boolean {
  const keyA = toPSTDateKey(a);
  const keyB = toPSTDateKey(b);
  return !!keyA && !!keyB && keyA === keyB;
}
