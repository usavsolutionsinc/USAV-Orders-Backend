'use client';

import { StaffRecipientList, type StaffRecipient } from '@/components/quick-access/StaffRecipientList';
import { Button } from '@/design-system/primitives';
import type { PhotoLibraryFilterState } from '@/lib/photos/library-filter-state';

const fieldClass =
  'h-10 w-full rounded-xl border border-gray-100 bg-gray-50/50 px-3 text-caption font-bold text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';
const labelClass = 'mb-1.5 block text-caption font-black uppercase tracking-[0.2em] text-gray-400';

interface PhotoLibraryFilterDropdownProps {
  filters: PhotoLibraryFilterState;
  onPatch: (next: Partial<PhotoLibraryFilterState>) => void;
  onClose: () => void;
  staffOptions: ReadonlyArray<StaffRecipient>;
}

export function PhotoLibraryFilterDropdown({
  filters,
  onPatch,
  onClose,
  staffOptions,
}: PhotoLibraryFilterDropdownProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className={labelClass}>Staff</span>
          <span className="truncate text-caption font-semibold text-gray-500">
            {filters.staffId
              ? staffOptions.find((opt) => String(opt.id) === filters.staffId)?.name ??
                `Staff #${filters.staffId}`
              : 'Any staff'}
          </span>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-2">
          <StaffRecipientList
            staff={staffOptions}
            onPick={(staff) => onPatch({ staffId: String(staff.id) })}
            currentStaffId={filters.staffId ? Number(filters.staffId) : null}
            emptyLabel="No staff available."
            title="Select staff"
            className="max-h-[220px]"
          />
          {filters.staffId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onPatch({ staffId: undefined })}
              className="mt-2 h-auto w-full rounded-lg border border-dashed border-gray-200 px-3 py-2 text-caption font-bold uppercase tracking-wider text-gray-500 hover:bg-white hover:text-gray-900"
            >
              Clear staff
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Damage</span>
          <select
            className={fieldClass}
            value={filters.damageDetected ?? ''}
            onChange={(e) => onPatch({ damageDetected: e.target.value || undefined })}
          >
            <option value="">Any</option>
            <option value="true">Damage detected</option>
            <option value="false">No damage flagged</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Analysis</span>
          <select
            className={fieldClass}
            value={filters.hasAnalysis ?? ''}
            onChange={(e) => onPatch({ hasAnalysis: e.target.value || undefined })}
          >
            <option value="">Any</option>
            <option value="true">Analyzed</option>
            <option value="false">Not analyzed</option>
          </select>
        </label>
      </div>

      <Button
        type="button"
        variant="brand"
        onClick={onClose}
        className="h-auto w-full rounded-2xl py-3.5 text-sm font-black uppercase tracking-widest"
      >
        Done
      </Button>
    </div>
  );
}
