'use client';

/**
 * Admin → Staff schedule — thin composition layer. Roster management lives in
 * Settings → Team; this pane is weekly shifts, availability rules, and the shop
 * calendar.
 *
 * Logic lives in focused hooks:
 *   - useStaffScheduleData ......... server data (existing)
 *   - useStaffScheduleFilters ...... `?search/staffView/staffId=` → filtered roster
 *   - useStaffScheduleRealtime ..... staff-channel invalidation
 *   - useStaffScheduleViewModel .... scheduleMap, today labels, editors, cell meta, summary
 */

import { useState } from 'react';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { AdminEmptyDetail } from './shared';
import { StaffScheduleBoard } from './StaffScheduleBoard';
import { useStaffScheduleData } from '@/hooks/admin/useStaffScheduleData';
import { useStaffScheduleFilters } from './staff-management/hooks/useStaffScheduleFilters';
import { useStaffScheduleRealtime } from './staff-management/hooks/useStaffScheduleRealtime';
import { useStaffScheduleViewModel } from './staff-management/hooks/useStaffScheduleViewModel';
import { StaffScheduleHeader } from './staff-management/StaffScheduleHeader';
import { StaffSummaryCells } from './staff-management/StaffSummaryCells';
import { AvailabilityRulesSection } from './staff-management/AvailabilityRulesSection';
import { BulkScheduleButtons } from './staff-management/BulkScheduleButtons';
import { WeeklyScheduleTable } from './staff-management/WeeklyScheduleTable';
import { NextWeekScheduleTable } from './staff-management/NextWeekScheduleTable';

export function StaffScheduleTab() {
  const [calendarExpanded, setCalendarExpanded] = useState(true);

  const data = useStaffScheduleData();
  useStaffScheduleRealtime();
  const { selectedStaffId, filteredStaff } = useStaffScheduleFilters(data.staff);
  const {
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
  } = useStaffScheduleViewModel({ data, filteredStaff });

  const {
    thisWeekDays,
    nextBusinessDays,
    allWeekDays,
    thisWeekStartDate,
    nextWeekStartDate,
  } = data;

  if (selectedStaffId == null) {
    return (
      <AdminEmptyDetail
        title="Pick a staffer"
        hint="Select someone on the left to view and edit their schedule and availability rules. Manage roster in Settings → Team."
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <StaffScheduleHeader
        total={summary.total}
        presentToday={summary.presentToday}
        isBusinessDayToday={isBusinessDayToday}
        todayLabel={todayLabel}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <StaffSummaryCells summary={summary} />

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
          editingStaffId={null}
          getScheduleCellMeta={getScheduleCellMeta}
          savingScheduleKey={schedule.savingScheduleKey}
          onToggleSchedule={schedule.toggleSchedule}
          onBlockedScheduleCell={handleBlockedScheduleCell}
          onStartEdit={() => {}}
          onCancelEdit={() => {}}
          onSaveEdit={() => {}}
          onDeleteStaff={() => {}}
          showStaffActions={false}
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
              Change the sidebar filters or add teammates in Settings → Team.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
