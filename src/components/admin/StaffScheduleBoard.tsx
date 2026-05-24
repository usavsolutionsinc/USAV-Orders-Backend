'use client';

/**
 * Day-columns work calendar — sits above the admin staff editor.
 *
 *   THIS WEEK · 9 AM – 5 PM · PT
 *   ┌────────┬────────┬────────┬────────┬────────┐
 *   │ MON 11 │ TUE 12 │ WED 13 │ THU 14 │ FRI 15 │
 *   │  ● M   │  ● M   │  ● M   │  ● M   │  ● M   │
 *   │  ● S   │  ● S   │  ● S   │  ● S   │  ● S   │
 *   │  ● T   │  ● T   │  ● T   │  ● T   │  ● T   │
 *   └────────┴────────┴────────┴────────┴────────┘
 *
 * Data source is the new shifts/templates model — fetches /api/shifts
 * with lazy server-side materialization. Each shift row paints one
 * avatar pill in its day column, using the staff's identity color_hex.
 *
 * "Off" / "Blocked" treatments are gone — if a staff has no shift on a
 * given day, they don't appear in that column. Cleaner read.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStaffColorHex } from '@/utils/staff-colors';

interface ShiftRow {
  id: number;
  staff_id: number;
  starts_at: string;
  ends_at: string;
  status: string;
  covers_shift_id: number | null;
  location_id: number | null;
  staff_name: string;
  color_hex: string;
  role: string;
}

interface StaffScheduleBoardProps {
  /** Mon-Fri labels for the "current" view. */
  thisWeekDays: { date: string; label: string }[];
  /** Mon-Fri labels for the "next" view. */
  nextBusinessDays: { date: string; label: string }[];
  todayDateKey: string;
  timezoneLabel: string;
  /** Click handler when an avatar is tapped — focus the editor below. */
  onSelectStaff?: (staffId: number) => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function formatHours(startsAt: string, endsAt: string, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
    return `${fmt.format(new Date(startsAt))} – ${fmt.format(new Date(endsAt))}`;
  } catch {
    return '9 AM – 5 PM';
  }
}

function formatDayNumber(dateKey: string): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export function StaffScheduleBoard({
  thisWeekDays,
  nextBusinessDays,
  todayDateKey,
  timezoneLabel,
  onSelectStaff,
}: StaffScheduleBoardProps) {
  const [weekView, setWeekView] = useState<'current' | 'next'>('current');
  const days = weekView === 'current' ? thisWeekDays : nextBusinessDays;
  const from = days[0]?.date;
  const to = days[days.length - 1]?.date;

  // Pulls real shift rows for the visible range. Server lazy-materializes
  // any staff whose horizon is behind `to` before responding, so this
  // is the source-of-truth and matches what the admin editor below uses.
  const { data, isLoading } = useQuery<{ shifts: ShiftRow[] }>({
    queryKey: ['shifts', 'range', from, to],
    enabled: Boolean(from && to),
    queryFn: async () => {
      const r = await fetch(`/api/shifts?from=${from}&to=${to}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed to fetch shifts');
      return r.json();
    },
    staleTime: 30 * 1000,
  });

  // Bucket shifts by date string (YYYY-MM-DD) for fast column lookup.
  const byDate = useMemo(() => {
    const map: Record<string, ShiftRow[]> = {};
    for (const s of data?.shifts ?? []) {
      const dateKey = s.starts_at.slice(0, 10);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(s);
    }
    return map;
  }, [data]);

  return (
    <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-md shadow-gray-200/40">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold tracking-tight text-gray-900">Work calendar</h2>
          <span className="rounded-full bg-gray-900 px-2.5 py-0.5 text-micro font-semibold uppercase tracking-[0.14em] text-white">
            9 AM – 5 PM
          </span>
          <span className="text-caption font-medium text-gray-500">{timezoneLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-gray-100 p-1">
          <WeekToggle label="This week" active={weekView === 'current'} onClick={() => setWeekView('current')} />
          <WeekToggle label="Next week" active={weekView === 'next'} onClick={() => setWeekView('next')} />
        </div>
      </div>

      {/* Day-columns grid */}
      <div className="grid grid-cols-5 divide-x divide-gray-100">
        {days.map((day) => {
          const isToday = day.date === todayDateKey;
          const dayShifts = byDate[day.date] ?? [];
          return (
            <div key={day.date} className="flex flex-col">
              {/* Day header */}
              <div
                className={`flex items-baseline justify-between gap-2 px-3 pt-3 pb-2 ${
                  isToday ? 'bg-gradient-to-b from-amber-50/70 to-transparent' : ''
                }`}
              >
                <div>
                  <p className={`text-[10.5px] font-bold uppercase tracking-[0.14em] ${isToday ? 'text-amber-700' : 'text-gray-500'}`}>
                    {day.label}
                  </p>
                  <p className={`mt-0.5 text-base font-bold tracking-tight ${isToday ? 'text-amber-900' : 'text-gray-900'}`}>
                    {formatDayNumber(day.date)}
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-micro font-bold tabular-nums text-gray-700">
                  {dayShifts.length}
                </span>
              </div>

              {/* Avatar pills */}
              <div className="flex flex-col gap-1 px-2 py-1.5">
                {isLoading && dayShifts.length === 0 && (
                  <p className="px-1 py-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-gray-300">
                    Loading…
                  </p>
                )}
                {!isLoading && dayShifts.length === 0 && (
                  <p className="px-1 py-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-gray-300">
                    No one in
                  </p>
                )}
                {dayShifts.map((shift) => (
                  <ShiftAvatarPill
                    key={shift.id}
                    shift={shift}
                    timezone={timezoneLabel}
                    onSelect={onSelectStaff}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-caption font-semibold uppercase tracking-[0.14em] transition ${
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

function ShiftAvatarPill({
  shift,
  timezone,
  onSelect,
}: {
  shift: ShiftRow;
  timezone: string;
  onSelect?: (staffId: number) => void;
}) {
  // getStaffColorHex picks up shift.color_hex first, then falls back to the
  // module cache — keeps the pill correct even mid-update.
  const color = getStaffColorHex({ id: shift.staff_id, color_hex: shift.color_hex });
  const isCovering = shift.covers_shift_id != null;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(shift.staff_id)}
      title={`${shift.staff_name} · ${formatHours(shift.starts_at, shift.ends_at, timezone)}${
        isCovering ? ' · covering shift' : ''
      }`}
      className="group flex items-center gap-1.5 rounded-full bg-white px-1.5 py-1 text-left ring-1 ring-gray-200 transition hover:bg-gray-50 hover:ring-gray-300"
    >
      <span
        aria-hidden
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-eyebrow font-bold text-white ring-2 ring-white"
        style={{ backgroundColor: color }}
      >
        {initials(shift.staff_name)}
      </span>
      <span className="truncate text-caption font-semibold text-gray-900">{shift.staff_name.split(/\s+/)[0]}</span>
      {isCovering && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-amber-800">
          Cover
        </span>
      )}
    </button>
  );
}
