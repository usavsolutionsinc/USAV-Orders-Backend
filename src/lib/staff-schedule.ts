export const STAFF_SCHEDULE_TIMEZONE = 'America/Los_Angeles';

export const STAFF_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type StaffDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAY_INDEX_BY_LABEL: Record<string, StaffDayOfWeek> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getCurrentStaffDayOfWeek(date: Date = new Date()): StaffDayOfWeek {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: STAFF_SCHEDULE_TIMEZONE,
    weekday: 'short',
  }).format(date);
  return WEEKDAY_INDEX_BY_LABEL[weekday] ?? 0;
}

export function getStaffWeekdayLabel(day: number): string {
  if (day < 0 || day > 6) return STAFF_WEEKDAY_LABELS[0];
  return STAFF_WEEKDAY_LABELS[day as StaffDayOfWeek];
}
