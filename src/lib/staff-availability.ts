import { addDays, isWeekend, startOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { StaffDayOfWeek } from '@/lib/staff-schedule';
import {
  STAFF_SCHEDULE_TIMEZONE,
  getCurrentStaffDayOfWeek,
  isStaffBusinessDay,
} from '@/lib/staff-schedule';
import { toPSTDateKey } from '@/utils/date';

export type StaffAvailabilityStatus = 'on' | 'off' | 'inactive';
export type StaffUnavailableReason = 'off_today' | 'inactive' | 'non_business_day';

export interface StaffAvailabilityMember {
  id: number;
  name: string;
  role: string;
  active: boolean;
  employeeId: string | null;
  status: StaffAvailabilityStatus;
  reason: StaffUnavailableReason | null;
}

export interface StaffAvailabilitySummary {
  total: number;
  on: number;
  off: number;
  inactive: number;
  techOn: number;
  techOff: number;
  techInactive: number;
  packerOn: number;
  packerOff: number;
  packerInactive: number;
}

export interface StaffAvailabilityResponse {
  timezone: string;
  date: string;
  dayOfWeek: StaffDayOfWeek;
  isBusinessDay: boolean;
  on: StaffAvailabilityMember[];
  off: StaffAvailabilityMember[];
  inactive: StaffAvailabilityMember[];
  summary: StaffAvailabilitySummary;
}

export interface StaffScheduleMatrixMember {
  id: number;
  name: string;
  role: string;
  active: boolean;
  employeeId: string | null;
}

export interface StaffScheduleMatrixDay {
  dayOfWeek: StaffDayOfWeek;
  date: string;
  label: string;
}

export interface StaffScheduleMatrixRow {
  staffId: number;
  dayOfWeek: StaffDayOfWeek;
  isScheduled: boolean;
}

export interface StaffScheduleMatrixResponse {
  timezone: string;
  days: StaffScheduleMatrixDay[];
  members: StaffScheduleMatrixMember[];
  rows: StaffScheduleMatrixRow[];
}

export interface RawStaffScheduleRow {
  id: number;
  name: string;
  role: string;
  active: boolean;
  employee_id: string | null;
  is_scheduled_today: boolean;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function getPstWeekStartMonday(from: Date): Date {
  const zoned = toZonedTime(from, STAFF_SCHEDULE_TIMEZONE);
  return startOfWeek(zoned, { weekStartsOn: 1 });
}

export function getWeekStartDateKeyForDate(from: Date): string {
  const monday = getPstWeekStartMonday(from);
  return formatInTimeZone(monday, STAFF_SCHEDULE_TIMEZONE, 'yyyy-MM-dd');
}

export function getWeekStartDateKeyForDateKey(dateKey: string): string {
  const parsed = fromZonedTime(`${dateKey}T00:00:00`, STAFF_SCHEDULE_TIMEZONE);
  return getWeekStartDateKeyForDate(parsed);
}

export function isMondayDateKey(dateKey: string): boolean {
  const parsed = fromZonedTime(`${dateKey}T00:00:00`, STAFF_SCHEDULE_TIMEZONE);
  const pstDow = getCurrentStaffDayOfWeek(parsed);
  return pstDow === 1;
}

export function getWeekDateKeys(weekStartDate: string): string[] {
  const monday = fromZonedTime(`${weekStartDate}T00:00:00`, STAFF_SCHEDULE_TIMEZONE);
  return [0, 1, 2, 3, 4, 5, 6].map((offset) =>
    formatInTimeZone(addDays(monday, offset), STAFF_SCHEDULE_TIMEZONE, 'yyyy-MM-dd')
  );
}

export function getCurrentBusinessWeekDays(from: Date = new Date()): StaffScheduleMatrixDay[] {
  const monday = getPstWeekStartMonday(from);

  return [0, 1, 2, 3, 4].map((offset) => {
    const dayDate = addDays(monday, offset);
    const dayOfWeek = getCurrentStaffDayOfWeek(dayDate);
    return {
      dayOfWeek,
      date: toPSTDateKey(dayDate),
      label: DOW_LABELS[dayOfWeek],
    };
  });
}

export function getNextBusinessDays(
  count: number,
  from: Date = new Date(),
): StaffScheduleMatrixDay[] {
  const days: StaffScheduleMatrixDay[] = [];
  let cursor = addDays(getPstWeekStartMonday(from), 7); // next Monday in PST

  while (days.length < count) {
    if (!isWeekend(cursor)) {
      const dayOfWeek = getCurrentStaffDayOfWeek(cursor);
      days.push({
        dayOfWeek,
        date: formatInTimeZone(cursor, STAFF_SCHEDULE_TIMEZONE, 'yyyy-MM-dd') || toPSTDateKey(cursor),
        label: DOW_LABELS[dayOfWeek],
      });
    }
    cursor = addDays(cursor, 1);
  }

  return days;
}

export function toAvailabilityResponse(
  rows: RawStaffScheduleRow[],
  options?: { now?: Date; roleFilter?: Set<string> }
): StaffAvailabilityResponse {
  const now = options?.now ?? new Date();
  const roleFilter = options?.roleFilter;
  const dayOfWeek = getCurrentStaffDayOfWeek(now);
  const isBusinessDay = isStaffBusinessDay(dayOfWeek);
  const date = toPSTDateKey(now);

  const on: StaffAvailabilityMember[] = [];
  const off: StaffAvailabilityMember[] = [];
  const inactive: StaffAvailabilityMember[] = [];

  for (const row of rows) {
    const role = String(row.role || '').trim();
    if (roleFilter && role && !roleFilter.has(role)) continue;

    const base = {
      id: Number(row.id),
      name: String(row.name || ''),
      role,
      active: Boolean(row.active),
      employeeId: row.employee_id ?? null,
    };

    if (!base.active) {
      inactive.push({ ...base, status: 'inactive', reason: 'inactive' });
      continue;
    }

    if (!isBusinessDay) {
      off.push({ ...base, status: 'off', reason: 'non_business_day' });
      continue;
    }

    if (Boolean(row.is_scheduled_today)) {
      on.push({ ...base, status: 'on', reason: null });
    } else {
      off.push({ ...base, status: 'off', reason: 'off_today' });
    }
  }

  const summary: StaffAvailabilitySummary = {
    total: on.length + off.length + inactive.length,
    on: on.length,
    off: off.length,
    inactive: inactive.length,
    techOn: on.filter((m) => m.role === 'technician').length,
    techOff: off.filter((m) => m.role === 'technician').length,
    techInactive: inactive.filter((m) => m.role === 'technician').length,
    packerOn: on.filter((m) => m.role === 'packer').length,
    packerOff: off.filter((m) => m.role === 'packer').length,
    packerInactive: inactive.filter((m) => m.role === 'packer').length,
  };

  return {
    timezone: STAFF_SCHEDULE_TIMEZONE,
    date,
    dayOfWeek,
    isBusinessDay,
    on,
    off,
    inactive,
    summary,
  };
}
