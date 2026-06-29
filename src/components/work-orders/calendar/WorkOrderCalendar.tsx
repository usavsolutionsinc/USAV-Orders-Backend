'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/design-system/primitives/Button';
import { Spinner } from '@/design-system/primitives/Spinner';
import { ChevronLeft, ChevronRight } from '@/components/Icons';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { useCalendarWorkOrders } from './useCalendarWorkOrders';
import {
  bucketByDay,
  dayKey,
  monthGridDays,
  monthGridRange,
} from './calendar-buckets';
import { WorkOrderCalendarChip } from './WorkOrderCalendarChip';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_PER_DAY = 4;

/**
 * Month-view scheduling calendar for work-order assignments (P3-ADM-03).
 *
 * Reads the windowed work_assignments feed (GET /api/work-orders/calendar) and
 * places each assignment on the day of its deadline (the reused placement
 * field — work_assignments has no scheduled_at). Each chip opens the shared
 * WorkOrderAssignPopover, which writes through the existing PATCH endpoint, so
 * the calendar both REFLECTS and CREATES/edits work_assignments.
 */
export function WorkOrderCalendar() {
  // The first day of the visible month, normalized to local midnight.
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const { from, to } = useMemo(() => monthGridRange(visibleMonth), [visibleMonth]);
  const days = useMemo(() => monthGridDays(visibleMonth), [visibleMonth]);
  const { rows, loading, error, refetch } = useCalendarWorkOrders(from, to);

  const buckets = useMemo(() => bucketByDay(rows), [rows]);
  const todayKey = dayKey(new Date());
  const currentMonth = visibleMonth.getMonth();

  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const goMonth = (delta: number) =>
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const goToday = () => {
    const now = new Date();
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-black tracking-tight text-slate-900">{monthLabel}</h1>
          {loading ? <Spinner className="h-4 w-4" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => goMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
          <Button variant="ghost" size="sm" onClick={() => goMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-label font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200 bg-slate-200 [gap:1px]">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-slate-50 px-2 py-1.5 text-center text-micro font-black uppercase tracking-wider text-slate-400"
          >
            {label}
          </div>
        ))}

        {days.map((day) => {
          const key = dayKey(day);
          const dayRows: WorkOrderRow[] = buckets.get(key) ?? [];
          const inMonth = day.getMonth() === currentMonth;
          const isToday = key === todayKey;
          const overflow = dayRows.length - MAX_VISIBLE_PER_DAY;

          return (
            <div
              key={key}
              className={`min-h-[104px] bg-white px-1.5 pb-1.5 pt-1 ${
                inMonth ? '' : 'bg-slate-50/60'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-caption font-bold ${
                    isToday
                      ? 'bg-blue-600 text-white'
                      : inMonth
                      ? 'text-slate-700'
                      : 'text-slate-300'
                  }`}
                >
                  {day.getDate()}
                </span>
                {dayRows.length > 0 ? (
                  <span className="text-eyebrow font-semibold text-slate-400">{dayRows.length}</span>
                ) : null}
              </div>

              <div className="flex flex-col gap-0.5">
                {dayRows.slice(0, MAX_VISIBLE_PER_DAY).map((row) => (
                  <WorkOrderCalendarChip key={row.id} row={row} onAssigned={refetch} />
                ))}
                {overflow > 0 ? (
                  <span className="px-1 text-eyebrow font-semibold text-slate-400">
                    +{overflow} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-caption text-slate-400">
        Assignments are placed on their deadline day. Click any item to view or reassign — changes
        save to the work-order queue.
      </p>
    </div>
  );
}
