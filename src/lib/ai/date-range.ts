import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { formatDatePST, getCurrentPSTDateKey } from '@/utils/date';
import type { AiTimeframe } from '@/lib/ai/types';

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(year, (month || 1) - 1, day || 1);
  next.setDate(next.getDate() + deltaDays);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

function buildExactLabel(start: string, end: string): string {
  if (start === end) return `${formatDatePST(start)} PST`;
  return `${formatDatePST(start)} to ${formatDatePST(end)} PST`;
}

export function resolveAiTimeframe(message: string, anchorDateKey?: string): AiTimeframe {
  const text = message.trim().toLowerCase();
  const baseDateKey = anchorDateKey || getCurrentPSTDateKey();

  if (/\byesterday\b/.test(text)) {
    const day = shiftDateKey(baseDateKey, -1);
    return {
      kind: 'yesterday',
      label: 'Yesterday',
      exactLabel: buildExactLabel(day, day),
      start: day,
      end: day,
      timezone: 'America/Los_Angeles',
      explicit: true,
    };
  }

  if (/\btoday\b/.test(text)) {
    return {
      kind: 'today',
      label: 'Today',
      exactLabel: buildExactLabel(baseDateKey, baseDateKey),
      start: baseDateKey,
      end: baseDateKey,
      timezone: 'America/Los_Angeles',
      explicit: true,
    };
  }

  if (/\blast week\b|\bprevious week\b/.test(text)) {
    const range = getWeekRangeForOffset(1, baseDateKey);
    return {
      kind: 'last_week',
      label: 'Last Week',
      exactLabel: buildExactLabel(range.startStr, range.endStr),
      start: range.startStr,
      end: range.endStr,
      timezone: 'America/Los_Angeles',
      explicit: true,
      weekOffset: 1,
    };
  }

  const range = getWeekRangeForOffset(0, baseDateKey);
  return {
    kind: 'this_week',
    label: 'This Week',
    exactLabel: buildExactLabel(range.startStr, range.endStr),
    start: range.startStr,
    end: range.endStr,
    timezone: 'America/Los_Angeles',
    explicit: /\bthis week\b|\bcurrent week\b|\bweek\b/.test(text),
    weekOffset: 0,
  };
}
