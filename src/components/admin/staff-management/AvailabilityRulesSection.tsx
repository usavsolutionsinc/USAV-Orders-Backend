import { sectionLabel, tableHeader, dataValue } from '@/design-system/tokens/typography/presets';
import { getStaffColorHex } from '@/utils/staff-colors';
import { getStaffWeekdayLabel } from '@/lib/staff-schedule';
import type { StaffDayOfWeek } from '@/lib/staff-schedule';
import { DEFAULT_AVAILABILITY_DRAFT, type WeekdayRuleBucket } from '@/hooks/admin/useStaffScheduleData';
import type { Staff } from '../types';
import type { useAvailabilityEditor } from './hooks/useAvailabilityEditor';

export function AvailabilityRulesSection({
  availability,
  allWeekDays,
  filteredStaff,
  getWeekdayRuleBucket,
}: {
  availability: ReturnType<typeof useAvailabilityEditor>;
  allWeekDays: Array<{ label: string; dayOfWeek: StaffDayOfWeek }>;
  filteredStaff: Staff[];
  getWeekdayRuleBucket: (staffId: number, dayOfWeek: StaffDayOfWeek) => WeekdayRuleBucket;
}) {
  const {
    availabilitySectionRef,
    availabilityEditor,
    setAvailabilityEditor,
    availabilityDraft,
    setAvailabilityDraft,
    selectedAvailabilityBucket,
    selectedAvailabilityRule,
    selectedAvailabilityStaff,
    saveAvailabilityRule,
    toggleAvailabilityAllowed,
    openAvailabilityEditorForDay,
    upsertAvailabilityRuleMutation,
    deleteAvailabilityRuleMutation,
  } = availability;

  return (
    <div ref={availabilitySectionRef} className="mb-6">
      <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
        <span>Availability Rules</span>
        <span>Permission to work by weekday</span>
      </div>

      {availabilityEditor && selectedAvailabilityStaff && (
        <div className="mb-3 border border-amber-200 bg-amber-50/60 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 pb-3">
            <div>
              <p className={`${sectionLabel} text-amber-900`}>Editing Availability</p>
              <p className={`${dataValue} mt-1 text-amber-950`}>
                {selectedAvailabilityStaff.name} • {getStaffWeekdayLabel(availabilityEditor.dayOfWeek)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAvailabilityEditor(null)}
              className={`${tableHeader} h-8 border border-amber-300 px-3 text-amber-800 hover:bg-amber-100`}
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>State</span>
              <select
                value={availabilityDraft.isAllowed ? 'allowed' : 'blocked'}
                onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, isAllowed: e.target.value === 'allowed' }))}
                className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
              >
                <option value="allowed">Allowed</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Start Date</span>
              <input
                type="date"
                value={availabilityDraft.effectiveStartDate}
                onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, effectiveStartDate: e.target.value }))}
                className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
              />
            </label>
            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>End Date</span>
              <input
                type="date"
                value={availabilityDraft.effectiveEndDate}
                onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, effectiveEndDate: e.target.value }))}
                className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
              />
            </label>
            <label className="space-y-1 md:col-span-1">
              <span className={`block ${sectionLabel}`}>Reason</span>
              <input
                type="text"
                value={availabilityDraft.reason}
                onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, reason: e.target.value }))}
                className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
                placeholder="Optional note"
              />
            </label>
          </div>

          <div className={`${tableHeader} mt-3 flex flex-wrap items-center gap-3 text-amber-900`}>
            <span>
              {selectedAvailabilityRule
                ? 'Editing existing weekday rule'
                : 'No explicit rule exists. Allowed state is inherited by default.'}
            </span>
            {selectedAvailabilityBucket?.extraRulesCount ? (
              <span>{selectedAvailabilityBucket.extraRulesCount} additional windowed rule(s) exist for this weekday.</span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={upsertAvailabilityRuleMutation.isPending}
              onClick={() => saveAvailabilityRule(availabilityEditor.staffId, availabilityEditor.dayOfWeek, availabilityDraft, selectedAvailabilityRule)}
              className={`${sectionLabel} h-9 border border-amber-800 bg-amber-800 px-4 text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {selectedAvailabilityRule ? 'Save Rule' : 'Create Rule'}
            </button>
            {selectedAvailabilityRule && (
              <button
                type="button"
                disabled={deleteAvailabilityRuleMutation.isPending}
                onClick={() => deleteAvailabilityRuleMutation.mutate(selectedAvailabilityRule.id)}
                className={`${sectionLabel} h-9 border border-red-300 bg-white px-4 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Delete Rule
              </button>
            )}
            {!selectedAvailabilityRule && (
              <button
                type="button"
                onClick={() => setAvailabilityDraft({ ...DEFAULT_AVAILABILITY_DRAFT })}
                className={`${sectionLabel} h-9 border border-gray-300 bg-white px-4 text-gray-700 hover:bg-gray-50`}
              >
                Reset Draft
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto border border-gray-200 bg-white">
        <div className="min-w-[1240px]">
          <div className="grid grid-cols-[minmax(320px,1fr)_repeat(7,minmax(120px,1fr))] items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5">
            <span className={tableHeader}>Staff</span>
            {allWeekDays.map((day) => (
              <span key={`availability-${day.dayOfWeek}`} className={`${tableHeader} text-center`}>
                {day.label}
              </span>
            ))}
          </div>

          {filteredStaff.map((member) => (
            <div
              key={`availability-row-${member.id}`}
              className={`grid grid-cols-[minmax(320px,1fr)_repeat(7,minmax(120px,1fr))] items-start border-b border-gray-100 px-4 py-3 ${
                member.active ? 'bg-white' : 'bg-gray-50 text-gray-500'
              }`}
            >
              <div className="flex min-w-0 items-start gap-2.5 pr-3">
                <span
                  aria-hidden
                  className="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-black/5"
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

              {allWeekDays.map((day) => {
                const bucket = getWeekdayRuleBucket(member.id, day.dayOfWeek);
                const isSelected = availabilityEditor?.staffId === member.id && availabilityEditor.dayOfWeek === day.dayOfWeek;
                const titleParts = [
                  `${member.name} • ${day.label}`,
                  bucket.primaryRule ? `Rule #${bucket.primaryRule.id}` : 'Default allow',
                  bucket.extraRulesCount ? `+${bucket.extraRulesCount} extra windowed rule(s)` : '',
                ].filter(Boolean);

                return (
                  <div key={`availability-cell-${member.id}-${day.dayOfWeek}`} className="px-1 text-center">
                    <button
                      type="button"
                      disabled={!member.active || upsertAvailabilityRuleMutation.isPending}
                      onClick={() => toggleAvailabilityAllowed(member.id, day.dayOfWeek, !bucket.displayedIsAllowed)}
                      title={titleParts.join(' • ')}
                      className={[
                        `${tableHeader} h-8 w-full border transition-colors`,
                        bucket.displayedIsAllowed
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-red-200 bg-red-50 text-red-700',
                        isSelected ? 'ring-1 ring-amber-500' : '',
                        !member.active ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                      ].join(' ')}
                    >
                      {bucket.displayedIsAllowed ? 'Allowed' : 'Blocked'}
                    </button>
                    <button
                      type="button"
                      disabled={!member.active}
                      onClick={() => openAvailabilityEditorForDay(member.id, day.dayOfWeek)}
                      className={`${tableHeader} mt-1 text-micro ${member.active ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400'}`}
                    >
                      Edit
                    </button>
                    {bucket.extraRulesCount > 0 && (
                      <div className="mt-1 text-micro font-bold text-amber-700">
                        +{bucket.extraRulesCount} window
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
