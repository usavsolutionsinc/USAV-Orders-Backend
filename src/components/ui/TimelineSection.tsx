'use client';

import type { ReactNode } from 'react';
import { EventTimeline, type TimelineGroupMode } from './EventTimeline';
import type { TimelineItem, TimelineGroupKey } from '@/lib/timeline/types';

/**
 * The drop-in activity-timeline block for any detail panel: a quiet section
 * header, a loading skeleton, an empty state, and the shared {@link EventTimeline}
 * — so a panel adds a full timeline with one line:
 *
 *   <TimelineSection title="Activity" loading={isLoading} items={items} />
 *
 * Owns nothing domain-specific; callers map their source through a
 * `*ToTimeline` adapter and hand the items here.
 */
export interface TimelineSectionProps {
  items: TimelineItem[];
  title?: string;
  /** Optional right-aligned slot in the header (a count, a filter, …). */
  headerRight?: ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  density?: 'comfortable' | 'compact';
  /** Identifier grouping (serial↔order toggle), forwarded to {@link EventTimeline}. */
  groupMode?: TimelineGroupMode;
  /** Override band bucketing in serial mode, forwarded to {@link EventTimeline}. */
  groupKeyOf?: (item: TimelineItem) => TimelineGroupKey | null;
  /** Rich (relative + hover-absolute) timestamps, forwarded to {@link EventTimeline}. */
  richTime?: boolean;
  /** Outer wrapper classes — spacing/divider live with the caller. */
  className?: string;
}

function TimelineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ol className="relative animate-pulse" aria-hidden>
      <span className="absolute left-[5px] top-1 bottom-1 w-px bg-gray-100" />
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="relative pl-5 pb-4 last:pb-0">
          <span className="absolute -left-[18px] top-[3px] h-[9px] w-[9px] rounded-full bg-gray-200 ring-[3px] ring-white" />
          <div className="flex items-baseline justify-between gap-3">
            <span className="h-2.5 rounded bg-gray-200" style={{ width: `${52 - i * 8}%` }} />
            <span className="h-2 w-12 rounded bg-gray-100" />
          </div>
          <span className="mt-1.5 block h-2 w-16 rounded bg-gray-100" />
        </li>
      ))}
    </ol>
  );
}

export function TimelineSection({
  items,
  title = 'Activity',
  headerRight,
  loading = false,
  emptyMessage = 'No activity recorded yet.',
  density = 'comfortable',
  groupMode = 'time',
  groupKeyOf,
  richTime = false,
  className = 'mx-8 mt-2 border-t border-gray-100 pt-4 pb-8',
}: TimelineSectionProps) {
  return (
    <section className={className}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-eyebrow font-bold uppercase tracking-[0.14em] text-gray-400">
          {title}
        </h3>
        {headerRight ? <div className="text-micro font-medium text-gray-400">{headerRight}</div> : null}
      </header>
      {loading ? (
        <TimelineSkeleton />
      ) : (
        <EventTimeline
          items={items}
          emptyMessage={emptyMessage}
          density={density}
          groupMode={groupMode}
          groupKeyOf={groupKeyOf}
          richTime={richTime}
        />
      )}
    </section>
  );
}
