import { sectionLabel, tableHeader, dataValue } from '@/design-system/tokens/typography/presets';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { getStaffColorHex } from '@/utils/staff-colors';
import type { StaffScheduleMatrixDay } from '@/lib/staff-availability';
import type { StaffDayOfWeek } from '@/lib/staff-schedule';
import type { Staff } from '../types';
import type { GetScheduleCellMeta } from './types';

export function NextWeekScheduleTable({
  calendarExpanded,
  onToggleExpanded,
  thisWeekStartDate,
  nextWeekStartDate,
  onCopyWeek,
  copyPending,
  weekUpdatePending,
  nextBusinessDays,
  filteredStaff,
  getScheduleCellMeta,
  savingScheduleKey,
  onToggleNextWeekSchedule,
  onBlockedScheduleCell,
}: {
  calendarExpanded: boolean;
  onToggleExpanded: () => void;
  thisWeekStartDate: string;
  nextWeekStartDate: string;
  onCopyWeek: (mode: 'from_week' | 'template') => void;
  copyPending: boolean;
  weekUpdatePending: boolean;
  nextBusinessDays: StaffScheduleMatrixDay[];
  filteredStaff: Staff[];
  getScheduleCellMeta: GetScheduleCellMeta;
  savingScheduleKey: string | null;
  onToggleNextWeekSchedule: (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string, isActive: boolean) => void;
  onBlockedScheduleCell: (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string) => void;
}) {
  return (
    <div className="mt-6">
      <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
        <span>Next Week (Mon-Fri)</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!thisWeekStartDate || !nextWeekStartDate || copyPending}
            onClick={() => onCopyWeek('from_week')}
            className={`${tableHeader} h-7`}
          >
            Copy This Week
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!thisWeekStartDate || !nextWeekStartDate || copyPending}
            onClick={() => onCopyWeek('template')}
            className={`${tableHeader} h-7`}
          >
            Reset to Template
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onToggleExpanded}
            className={`${tableHeader} h-7`}
          >
            {calendarExpanded ? 'Hide' : 'Show'}
          </Button>
        </div>
      </div>

      {calendarExpanded && (
        <div className="overflow-x-auto border border-gray-200 bg-white">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-[minmax(320px,1fr)_repeat(5,minmax(90px,1fr))] items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5">
              <span className={tableHeader}>Staff</span>
              {nextBusinessDays.map((day) => (
                <span key={`upcoming-${day.date}`} className={`${tableHeader} text-center`}>
                  {day.label} {day.date.slice(5)}
                </span>
              ))}
            </div>
            {filteredStaff.map((member) => (
              <div
                key={`upcoming-row-${member.id}`}
                className={`grid grid-cols-[minmax(320px,1fr)_repeat(5,minmax(90px,1fr))] items-center border-b border-gray-100 px-4 py-2 ${
                  member.active ? 'bg-white' : 'bg-gray-50'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-black/5"
                    style={{ backgroundColor: getStaffColorHex(member) }}
                  />
                  <p className={`${dataValue} truncate uppercase tracking-[0.02em] ${member.active ? 'text-gray-900' : 'text-gray-500'}`}>
                    {member.name}
                  </p>
                </div>
                {nextBusinessDays.map((day) => {
                  const { isScheduled, blockedByRule, hasConflict } = getScheduleCellMeta(member.id, day.date, day.dayOfWeek, 'next');
                  const buttonKey = `${member.id}:${day.date}`;
                  const isDisabled = !member.active || savingScheduleKey === buttonKey || weekUpdatePending;
                  return (
                    <HoverTooltip
                      key={`upcoming-${member.id}-${day.date}`}
                      label={`${member.name} • ${day.label} ${day.date}${blockedByRule ? ' • blocked by availability rule' : ''}`}
                      asChild
                    >
                      {/* ds-raw-button: multi-state schedule-cell toggle (5 conditional states, aria-pressed) */}
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          if (blockedByRule) {
                            onBlockedScheduleCell(member.id, day.dayOfWeek, day.date);
                            return;
                          }
                          onToggleNextWeekSchedule(member.id, day.dayOfWeek, day.date, Boolean(member.active));
                        }}
                        className={[
                          `${tableHeader} mx-2 h-7 border text-center leading-7 transition-colors`,
                          !member.active
                            ? 'border-gray-200 bg-gray-100 text-gray-400'
                            : hasConflict
                              ? 'border-amber-300 bg-amber-50 text-amber-800'
                              : blockedByRule
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : isScheduled
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-500',
                          isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                        ].join(' ')}
                        aria-pressed={isScheduled}
                        aria-label={`${member.name} next week ${day.label} ${member.active ? (blockedByRule ? 'blocked' : isScheduled ? 'scheduled' : 'off') : 'inactive'}`}
                      >
                        {!member.active ? 'Inactive' : hasConflict ? 'Conflict' : blockedByRule ? 'Blocked' : isScheduled ? 'On' : 'Off'}
                      </button>
                    </HoverTooltip>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
