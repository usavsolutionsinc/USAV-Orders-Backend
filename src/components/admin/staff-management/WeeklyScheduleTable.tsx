import { tableHeader, dataValue } from '@/design-system/tokens/typography/presets';
import { getStaffColorHex } from '@/utils/staff-colors';
import type { StaffScheduleMatrixDay } from '@/lib/staff-availability';
import type { StaffDayOfWeek } from '@/lib/staff-schedule';
import type { Staff } from '../types';
import { StaffEditCard } from './StaffEditCard';
import type { StaffUpdatePayload } from './constants';
import type { GetScheduleCellMeta } from './types';

export function WeeklyScheduleTable({
  thisWeekDays,
  filteredStaff,
  todayDateKey,
  editingStaffId,
  getScheduleCellMeta,
  savingScheduleKey,
  onToggleSchedule,
  onBlockedScheduleCell,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteStaff,
  showStaffActions = true,
}: {
  thisWeekDays: StaffScheduleMatrixDay[];
  filteredStaff: Staff[];
  todayDateKey: string;
  editingStaffId: number | null;
  getScheduleCellMeta: GetScheduleCellMeta;
  savingScheduleKey: string | null;
  onToggleSchedule: (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string, isActive: boolean) => void;
  onBlockedScheduleCell: (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string) => void;
  onStartEdit: (member: Staff) => void;
  onCancelEdit: () => void;
  onSaveEdit: (payload: StaffUpdatePayload) => void;
  onDeleteStaff: (id: number) => void;
  showStaffActions?: boolean;
}) {
  const gridCols = showStaffActions
    ? 'grid-cols-[minmax(320px,1fr)_repeat(5,minmax(54px,1fr))_120px]'
    : 'grid-cols-[minmax(320px,1fr)_repeat(5,minmax(54px,1fr))]';

  return (
    <div className="overflow-x-auto border border-gray-200 bg-white">
      <div className="min-w-[980px]">
        <div className={`grid ${gridCols} items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5`}>
          <span className={tableHeader}>Staff</span>
          {thisWeekDays.map((day) => (
            <span
              key={`header-${day.date}`}
              className={`${tableHeader} text-center ${
                day.date === todayDateKey ? 'text-gray-900' : ''
              }`}
            >
              {day.label} {day.date.slice(5)}
            </span>
          ))}
          {showStaffActions ? <span className={`${tableHeader} text-right`}>Actions</span> : null}
        </div>

        {filteredStaff.map((member) => {
          if (editingStaffId === member.id) {
            return (
              <StaffEditCard
                key={member.id}
                member={member}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
                onDelete={() => onDeleteStaff(member.id)}
              />
            );
          }

          return (
            <div
              key={member.id}
              className={`grid ${gridCols} items-center border-b border-gray-100 px-4 py-2.5 ${
                !member.active ? 'bg-gray-50 text-gray-500' : 'bg-white'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5 pr-3">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-black/5"
                  style={{ backgroundColor: getStaffColorHex(member) }}
                  title={`Color: ${getStaffColorHex(member)}`}
                />
                <div className="min-w-0">
                  <p className={`${dataValue} truncate uppercase tracking-[0.02em]`}>
                    {member.name}
                  </p>
                  <div className={`${tableHeader} mt-0.5 flex items-center gap-2`}>
                    <span>{member.role}</span>
                    {member.employee_id ? <span>ID {member.employee_id}</span> : null}
                    <span>{member.active ? 'Active' : 'Inactive'}</span>
                  </div>
                </div>
              </div>

              {thisWeekDays.map((day) => {
                const { isScheduled, blockedByRule, hasConflict } = getScheduleCellMeta(member.id, day.date, day.dayOfWeek, 'current');
                const isToday = day.date === todayDateKey;
                const buttonKey = `${member.id}:${day.date}`;
                const isDisabled = !member.active || savingScheduleKey === buttonKey;

                return (
                  <button
                    key={`${member.id}-${day.date}`}
                    type="button"
                    onClick={() => {
                      if (blockedByRule) {
                        onBlockedScheduleCell(member.id, day.dayOfWeek, day.date);
                        return;
                      }
                      onToggleSchedule(member.id, day.dayOfWeek, day.date, Boolean(member.active));
                    }}
                    disabled={isDisabled}
                    className={[
                      `mx-1 h-8 border ${tableHeader} transition-colors`,
                      hasConflict
                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : blockedByRule
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : isScheduled
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-50 text-gray-500',
                      isToday ? 'outline outline-1 outline-gray-900/30' : '',
                      isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                    ].join(' ')}
                    aria-pressed={isScheduled}
                    aria-label={`${member.name} ${day.label} ${member.active ? (blockedByRule ? 'blocked' : isScheduled ? 'scheduled' : 'off') : 'inactive'}`}
                    title={`${member.name} • ${day.label} ${day.date}${blockedByRule ? ' • blocked by availability rule' : ''}`}
                  >
                    {hasConflict ? 'Conflict' : blockedByRule ? 'Blocked' : isScheduled ? 'On' : 'Off'}
                  </button>
                );
              })}

              {showStaffActions ? (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => onStartEdit(member)}
                    className={`${tableHeader} h-8 border border-gray-300 px-3 text-gray-700 transition-colors hover:bg-gray-50`}
                  >
                    Edit
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
