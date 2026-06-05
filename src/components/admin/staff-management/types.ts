import type { StaffDayOfWeek } from '@/lib/staff-schedule';

export type ScheduleCellMeta = {
  isScheduled: boolean;
  blockedByRule: boolean;
  hasConflict: boolean;
};

export type GetScheduleCellMeta = (
  staffId: number,
  scheduleDate: string,
  dayOfWeek: StaffDayOfWeek,
  weekScope: 'current' | 'next',
) => ScheduleCellMeta;

export type SummaryTotals = {
  total: number;
  active: number;
  inactive: number;
  technicians: number;
  packers: number;
  presentToday: number;
  offToday: number;
};
