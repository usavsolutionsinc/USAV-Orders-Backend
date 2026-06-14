'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { StaffScheduleBoard } from './StaffScheduleBoard';
import { toast } from '@/lib/toast';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStaffChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAuth } from '@/contexts/AuthContext';
import { getCurrentPSTDateKey } from '@/utils/date';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { AdminEmptyDetail } from './shared';
import {
  STAFF_SCHEDULE_TIMEZONE,
  type StaffDayOfWeek,
  getCurrentStaffDayOfWeek,
  getStaffWeekdayLabel,
  isStaffBusinessDay,
} from '@/lib/staff-schedule';
import {
  useStaffScheduleData,
  getPlannedScheduleState,
  type ScheduleMap,
  type WeekdayRuleBucket,
} from '@/hooks/admin/useStaffScheduleData';

import { useStaffCrudMutations } from './staff-management/hooks/useStaffCrudMutations';
import { useStaffScheduleEditor } from './staff-management/hooks/useStaffScheduleEditor';
import { useAvailabilityEditor } from './staff-management/hooks/useAvailabilityEditor';
import { AddStaffForm } from './staff-management/AddStaffForm';
import { StaffSummaryCells } from './staff-management/StaffSummaryCells';
import { AvailabilityRulesSection } from './staff-management/AvailabilityRulesSection';
import { BulkScheduleButtons } from './staff-management/BulkScheduleButtons';
import { WeeklyScheduleTable } from './staff-management/WeeklyScheduleTable';
import { NextWeekScheduleTable } from './staff-management/NextWeekScheduleTable';

export function StaffManagementTab() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const staffChannelName = safeChannelName(() => getStaffChannelName(orgId!));

  // All queries + derived data from the extracted hook
  const {
    staff, scheduleResponse,
    thisWeekDays, nextBusinessDays, allWeekDays,
    thisWeekStartDate, nextWeekStartDate,
    availabilityRuleMap, currentWeekDetailMap, nextWeekDetailMap,
  } = useStaffScheduleData();

  const { createStaffMutation, updateStaffMutation, deleteStaffMutation } = useStaffCrudMutations({
    onAfterCreate: () => setIsAddingStaff(false),
    onAfterMutateMember: () => setEditingStaffId(null),
  });

  useEffect(() => {
    const handleOpenAdd = () => setIsAddingStaff(true);
    window.addEventListener('admin-staff-open-add', handleOpenAdd as EventListener);
    return () => window.removeEventListener('admin-staff-open-add', handleOpenAdd as EventListener);
  }, []);

  useAblyChannel(staffChannelName, 'staff.schedule.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
    queryClient.invalidateQueries({ queryKey: qk.staff.all });
  }, !!staffChannelName);

  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const staffView = searchParams.get('staffView') || 'all';
  const selectedStaffId = (() => {
    const raw = searchParams.get('staffId');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const filteredStaff = useMemo(() => {
    return staff.filter((member) => {
      // When a staffer is selected from the sidebar, narrow the entire main
      // pane to just that one. Search + view filters still apply (so deselect
      // if they no longer match).
      if (selectedStaffId != null && member.id !== selectedStaffId) return false;

      const matchesSearch =
        !searchTerm ||
        member.name.toLowerCase().includes(searchTerm) ||
        (member.employee_id || '').toLowerCase().includes(searchTerm);

      const matchesView =
        staffView === 'active'
          ? Boolean(member.active)
          : staffView === 'inactive'
            ? !member.active
            : staffView === 'technician'
              ? member.role === 'technician'
              : staffView === 'packer'
                ? member.role === 'packer'
                : true;

      return matchesSearch && matchesView;
    });
  }, [searchTerm, staff, staffView, selectedStaffId]);

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
    weekScope: 'current' | 'next'
  ) => {
    const detail = getWeekDetail(staffId, scheduleDate, weekScope);
    const isScheduled = schedule.getIsScheduled(staffId, scheduleDate);
    const blockedByRule = detail ? !detail.allowedByRule : !getWeekdayRuleBucket(staffId, dayOfWeek).displayedIsAllowed;
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
      { total: 0, active: 0, inactive: 0, technicians: 0, packers: 0, presentToday: 0, offToday: 0 }
    );
    // getIsScheduled intentionally omitted — summary tracks the persisted
    // scheduleMap, not transient optimistic toggles (matches prior behavior).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStaff, isBusinessDayToday, scheduleMap, todayDateKey]);

  const handleBlockedScheduleCell = (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string) => {
    availability.openAvailabilityEditorForDay(staffId, dayOfWeek);
    toast.message(`Blocked by availability rule for ${scheduleDate}`);
  };

  // When no staffer is selected from the sidebar and the add-staff form
  // isn't open, the main pane is in the canonical detail-on-right empty
  // state. Keeps the section consistent with Access/Roles/Goals.
  if (selectedStaffId == null && !isAddingStaff) {
    return (
      <AdminEmptyDetail
        title="Pick a staffer"
        hint="Select a staff member on the left to view and edit their info, schedule, and availability rules."
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-6`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>
            Staff Directory
          </p>
          <div className={`${sectionLabel} hidden items-center gap-3 sm:flex`}>
            <span>Shown {summary.total}</span>
            <span className="text-gray-500">/</span>
            <span>Scheduled Today {isBusinessDayToday ? summary.presentToday : 0}</span>
            <span className="text-gray-500">/</span>
            <span>{todayLabel}</span>
          </div>
        </div>
      </div>

      {isAddingStaff && (
        <AddStaffForm
          onCancel={() => setIsAddingStaff(false)}
          onCreate={(payload) => createStaffMutation.mutate(payload)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <StaffSummaryCells summary={summary} />

        {/* Shared work calendar — day columns + colored avatar stacks.
            Reads /api/shifts (real shift instances, lazy-materialized from
            templates server-side). Sits above the row-per-staff editor
            so the whole shop can see who's in this week without scrolling. */}
        <div className="mb-6">
          <StaffScheduleBoard
            thisWeekDays={thisWeekDays}
            nextBusinessDays={nextBusinessDays}
            todayDateKey={todayDateKey}
            timezoneLabel={timezoneLabel}
          />
        </div>

        <AvailabilityRulesSection
          availability={availability}
          allWeekDays={allWeekDays}
          filteredStaff={filteredStaff}
          getWeekdayRuleBucket={getWeekdayRuleBucket}
        />

        <BulkScheduleButtons onApply={schedule.applyBulkByRole} />

        <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
          <span>Weekly Schedule</span>
          <span>{isBusinessDayToday ? todayLabel : `${todayLabel} (off day)`} • {timezoneLabel}</span>
        </div>

        <WeeklyScheduleTable
          thisWeekDays={thisWeekDays}
          filteredStaff={filteredStaff}
          todayDateKey={todayDateKey}
          editingStaffId={editingStaffId}
          getScheduleCellMeta={getScheduleCellMeta}
          savingScheduleKey={schedule.savingScheduleKey}
          onToggleSchedule={schedule.toggleSchedule}
          onBlockedScheduleCell={handleBlockedScheduleCell}
          onStartEdit={(member) => setEditingStaffId(member.id)}
          onCancelEdit={() => setEditingStaffId(null)}
          onSaveEdit={(payload) => updateStaffMutation.mutate(payload)}
          onDeleteStaff={(id) => deleteStaffMutation.mutate(id)}
        />

        <NextWeekScheduleTable
          calendarExpanded={calendarExpanded}
          onToggleExpanded={() => setCalendarExpanded((v) => !v)}
          thisWeekStartDate={thisWeekStartDate}
          nextWeekStartDate={nextWeekStartDate}
          onCopyWeek={(mode) =>
            schedule.copyWeekScheduleMutation.mutate({
              fromWeekStartDate: thisWeekStartDate,
              toWeekStartDate: nextWeekStartDate,
              mode,
              includeInactive: false,
            })
          }
          copyPending={schedule.copyWeekScheduleMutation.isPending}
          weekUpdatePending={schedule.updateWeekScheduleMutation.isPending}
          nextBusinessDays={nextBusinessDays}
          filteredStaff={filteredStaff}
          getScheduleCellMeta={getScheduleCellMeta}
          savingScheduleKey={schedule.savingScheduleKey}
          onToggleNextWeekSchedule={schedule.toggleNextWeekSchedule}
          onBlockedScheduleCell={handleBlockedScheduleCell}
        />

        {filteredStaff.length === 0 && (
          <div className="border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <p className={sectionLabel}>No Staff Match</p>
            <p className="mt-2 text-label font-bold text-gray-500">
              Change the sidebar filters or add a team member.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
