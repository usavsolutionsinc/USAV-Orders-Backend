'use client';

import { format, parseISO } from 'date-fns';
import type { TimelineItem, TimelineTone } from '@/lib/timeline/types';

/**
 * Shared, domain-agnostic event timeline — the vertical day-banded trail used by
 * detail panels across the app (carrier events, order tracking/label events,
 * receiving/tech/warranty/repair history…). It renders generic {@link TimelineItem}s;
 * each domain provides a `*ToTimeline` adapter (`src/lib/timeline/*`) — panels
 * never hand-roll a timeline.
 *
 * Extracted verbatim from the receiving "Recent carrier events" trail so its look
 * is unchanged; the tone registry below is the single source of truth for dot/badge
 * colors.
 */

const DOT_TONE: Record<TimelineTone, string> = {
  default: 'bg-blue-500',
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  muted: 'bg-gray-300',
};

const BADGE_TONE: Record<TimelineTone, string> = {
  default: 'bg-gray-100 text-gray-600',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
  muted: 'bg-gray-100 text-gray-600',
};

function fmt(value: string | null | undefined, pattern: string): string {
  if (!value) return '—';
  try {
    return format(typeof value === 'string' ? parseISO(value) : value, pattern);
  } catch {
    return value;
  }
}

export interface EventTimelineProps {
  items: TimelineItem[];
  emptyMessage?: string;
  /** Group rows under "EEE, MMM d" day bands (default true). */
  groupByDay?: boolean;
  /** Ring + highlight the first (latest) row (default true). */
  highlightLatest?: boolean;
}

export function EventTimeline({
  items,
  emptyMessage = 'No events yet.',
  groupByDay = true,
  highlightLatest = true,
}: EventTimelineProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center px-4 text-center text-caption font-medium text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ol className="relative ml-1 border-l border-gray-200">
      {items.map((item, i) => {
        const time = fmt(item.at, 'h:mma');
        const dayKey = fmt(item.at, 'EEE, MMM d');
        const showDay = groupByDay && (i === 0 || dayKey !== fmt(items[i - 1]?.at, 'EEE, MMM d'));
        const isLatest = highlightLatest && i === 0;
        const dot = DOT_TONE[item.tone ?? 'info'];
        return (
          <li key={item.id} className="relative">
            {showDay ? (
              <div className="-ml-px mb-1.5 mt-1 border-l-2 border-transparent pl-5 text-eyebrow font-black uppercase tracking-wider text-gray-400 first:mt-0">
                {dayKey}
              </div>
            ) : null}
            <div className="relative pb-4 pl-5 last:pb-0">
              {item.icon ? (
                <span className="absolute -left-[7px] top-[3px] flex h-3.5 w-3.5 items-center justify-center text-gray-400">
                  {item.icon}
                </span>
              ) : (
                <span
                  className={`absolute -left-[5px] top-[5px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot} ${
                    isLatest ? 'shadow-[0_0_0_3px_rgba(59,130,246,0.15)]' : ''
                  }`}
                />
              )}
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-caption font-black ${isLatest ? 'text-gray-900' : 'text-gray-700'}`}>
                  {item.title}
                </span>
                <span className="shrink-0 whitespace-nowrap text-eyebrow font-semibold tabular-nums text-gray-400">
                  {time}{item.actor ? ` · ${item.actor}` : ''}
                </span>
              </div>
              {item.subtitle ? (
                <div className="mt-0.5 text-eyebrow font-semibold uppercase tracking-wide text-gray-400">
                  {item.subtitle}
                </div>
              ) : null}
              {item.badges?.map((badge, bi) => (
                <div
                  key={bi}
                  className={`mt-1 mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-eyebrow font-bold ${BADGE_TONE[badge.tone]}`}
                >
                  {badge.label}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
