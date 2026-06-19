'use client';

import { Calendar, Clock, History } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import {
  datePresetFromFilters,
  formatPhotoLibraryDateRange,
  type PhotoLibraryDatePreset,
  type PhotoLibraryFilterState,
} from '@/lib/photos/library-filter-state';
import { DATE_PRESET_LABELS } from '@/lib/photos/library-refinements';
import { StaffRecipientList, type StaffRecipient } from '@/components/quick-access/StaffRecipientList';

const DATE_PRESET_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', icon: Calendar },
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'yesterday', label: 'Yesterday', icon: History },
  { id: 'last7', label: '7d', icon: Calendar },
  { id: 'custom', label: 'Custom', icon: Calendar },
];

const fieldClass =
  'h-10 w-full rounded-xl border border-gray-100 bg-gray-50/50 px-3 text-caption font-bold text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';
const labelClass = 'mb-1.5 block text-[11px] font-black uppercase tracking-[0.2em] text-gray-400';

interface PhotoLibraryFilterDropdownProps {
  filters: PhotoLibraryFilterState;
  onPatch: (next: Partial<PhotoLibraryFilterState>) => void;
  onDatePreset: (preset: PhotoLibraryDatePreset) => void;
  onClose: () => void;
  staffOptions: ReadonlyArray<StaffRecipient>;
}

export function PhotoLibraryFilterDropdown({
  filters,
  onPatch,
  onDatePreset,
  onClose,
  staffOptions,
}: PhotoLibraryFilterDropdownProps) {
  const datePreset = datePresetFromFilters(filters);
  const dateRangeLabel = formatPhotoLibraryDateRange(filters);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className={labelClass}>Date range</p>
          <p className="truncate text-[11px] font-semibold text-gray-500">{dateRangeLabel}</p>
        </div>
        <HorizontalButtonSlider
          items={DATE_PRESET_ITEMS}
          value={datePreset}
          onChange={(id) => onDatePreset(id as PhotoLibraryDatePreset)}
          variant="nav"
          dense
          className="w-full"
          aria-label="Photo date range"
        />
        {datePreset === 'custom' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="From date"
              className={fieldClass}
              value={filters.dateFrom ?? ''}
              onChange={(e) => onPatch({ dateFrom: e.target.value || undefined })}
            />
            <input
              type="date"
              aria-label="To date"
              className={fieldClass}
              value={filters.dateTo ?? ''}
              onChange={(e) => onPatch({ dateTo: e.target.value || undefined })}
            />
          </div>
        ) : datePreset !== 'all' ? (
          <p className="mt-2 text-micro font-medium text-gray-500">{DATE_PRESET_LABELS[datePreset]}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className={labelClass}>Staff</span>
          <span className="truncate text-[11px] font-semibold text-gray-500">
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
            <button
              type="button"
              onClick={() => onPatch({ staffId: undefined })}
              className="mt-2 w-full rounded-lg border border-dashed border-gray-200 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 hover:bg-white hover:text-gray-900"
            >
              Clear staff
            </button>
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

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-2xl bg-gray-900 py-3.5 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-black"
      >
        Done
      </button>
    </div>
  );
}
