'use client';

/**
 * View-model for the Staff Schedule tab: builds the per-staff scheduled-date map,
 * resolves the "today" labels, composes the schedule + availability editors, and
 * derives the per-cell meta + the roster summary. Keeps the tab a pure
 * composition surface. Extracted from StaffScheduleTab; behaviour is unchanged.
 */

import { useMemo } from 'react';
import { toast } from '@/lib/toast';
import { getCurrentPSTDateKey } from '@/utils/date';
import {
  STAFF_SCHEDULE_TIMEZONE,
  type StaffDayOfWeek,
  getCurrentStaffDayOfWeek,
  getStaffWeekdayLabel,
  isStaffBusinessDay,
} from '@/lib/staff-schedule';
import {
  getPlannedScheduleState,
  type ScheduleMap,
  type WeekdayRuleBucket,
  type useStaffScheduleData,
} from '@/hooks/admin/useStaffScheduleData';
import { useStaffScheduleEditor } from '../hooks/useStaffScheduleEditor';
import { useAvailabilityEditor } from '../hooks/useAvailabilityEditor';

type StaffScheduleData = ReturnType<typeof useStaffScheduleData>;
type StaffList = StaffScheduleData['staff'];

interface UseStaffScheduleViewModelArgs {
  data: StaffScheduleData;
  filteredStaff: StaffList;
}

export function useStaffScheduleViewModel({ data, filteredStaff }: UseStaffScheduleViewModelArgs) {
  const {
    staff,
    scheduleResponse,
    thisWeekDays,
    nextBusinessDays,
    nextWeekStartDate,
    availabilityRuleMap,
    currentWeekDetailMap,
    nextWeekDetailMap,
  } = data;

  const scheduleMap = useMemo<ScheduleMap>(() => {
    const map: ScheduleMap = {};

    for (const member of staff) {
      map[member.id] = {};
      for (const day of [...thisWeekDays, ...nextBusinessDays]) {
        map[member.id][day.date] = true;
      }
    }

    for (const row of scheduleResponse?.schedules || []) {
      if (!map[row.staff_id]) map[row.staff_id] = {};
      const dateKey = String(row.schedule_date || '');
      if (dateKey) map[row.staff_id][dateKey] = Boolean(row.is_scheduled);
    }

    return map;
  }, [nextBusinessDays, scheduleResponse?.schedules, staff, thisWeekDays]);

  const todayDay = Number.isFinite(Number(scheduleResponse?.today_day_of_week))
    ? Number(scheduleResponse?.today_day_of_week)
    : getCurrentStaffDayOfWeek();
  const isBusinessDayToday = isStaffBusinessDay(todayDay);
  const todayLabel = getStaffWeekdayLabel(todayDay);
  const timezoneLabel = scheduleResponse?.timezone || STAFF_SCHEDULE_TIMEZONE;
  const todayDateKey = getCurrentPSTDateKey();

  const getWeekdayRuleBucket = (staffId: number, dayOfWeek: StaffDayOfWeek): WeekdayRuleBucket => {
    return availabilityRuleMap[staffId]?.[dayOfWeek] || {
      primaryRule: null,
      extraRulesCount: 0,
      displayedIsAllowed: true,
    };
  };

  const schedule = useStaffScheduleEditor({
    scheduleMap,
    thisWeekDays,
    nextWeekStartDate,
    filteredStaff,
  });

  const availability = useAvailabilityEditor({ staff, getWeekdayRuleBucket });

  const getWeekDetail = (staffId: number, scheduleDate: string, weekScope: 'current' | 'next') => {
    return weekScope === 'current'
      ? currentWeekDetailMap[staffId]?.[scheduleDate]
      : nextWeekDetailMap[staffId]?.[scheduleDate];
  };

  const getScheduleCellMeta = (
    staffId: number,
    scheduleDate: string,
    dayOfWeek: StaffDayOfWeek,
    weekScope: 'current' | 'next',
  ) => {
    const detail = getWeekDetail(staffId, scheduleDate, weekScope);
    const isScheduled = schedule.getIsScheduled(staffId, scheduleDate);
    const blockedByRule = detail
      ? !detail.allowedByRule
      : !getWeekdayRuleBucket(staffId, dayOfWeek).displayedIsAllowed;
    const hasConflict = blockedByRule && getPlannedScheduleState(detail);
    return { detail, isScheduled, blockedByRule, hasConflict };
  };

  const summary = useMemo(() => {
    return filteredStaff.reduce(
      (acc, member) => {
        acc.total += 1;
        if (member.active) acc.active += 1;
        else acc.inactive += 1;
        if (member.role === 'technician') acc.technicians += 1;
        if (member.role === 'packer') acc.packers += 1;
        if (isBusinessDayToday) {
          const isScheduledToday = schedule.getIsScheduled(member.id, todayDateKey);
          if (member.active && isScheduledToday) acc.presentToday += 1;
          else if (member.active) acc.offToday += 1;
        }
        return acc;
      },
      { total: 0, active: 0, inactive: 0, technicians: 0, packers: 0, presentToday: 0, offToday: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStaff, isBusinessDayToday, scheduleMap, todayDateKey]);

  const handleBlockedScheduleCell = (
    staffId: number,
    dayOfWeek: StaffDayOfWeek,
    scheduleDate: string,
  ) => {
    availability.openAvailabilityEditorForDay(staffId, dayOfWeek);
    toast.message(`Blocked by availability rule for ${scheduleDate}`);
  };

  return {
    schedule,
    availability,
    isBusinessDayToday,
    todayLabel,
    timezoneLabel,
    todayDateKey,
    getWeekdayRuleBucket,
    getScheduleCellMeta,
    summary,
    handleBlockedScheduleCell,
  };
}
