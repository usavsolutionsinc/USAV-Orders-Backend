'use client';

import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import {
  DATE_PRESET_LABELS,
  datePresetFromFilters,
} from '@/lib/photos/library-refinements';
import {
  PHOTO_ENTITY_TYPE_LABELS,
  type PhotoLibraryDatePreset,
  type PhotoLibraryFilterState,
} from '@/lib/photos/library-filter-state';

const DATE_PRESET_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yest.' },
  { id: 'last7', label: '7d' },
  { id: 'custom', label: 'Custom' },
];

const fieldClass =
  'h-10 w-full rounded-xl border border-gray-100 bg-gray-50/50 px-3 text-caption font-bold text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';
const labelClass = 'mb-1.5 block text-[11px] font-black uppercase tracking-[0.2em] text-gray-400';

interface PhotoLibraryFilterDropdownProps {
  filters: PhotoLibraryFilterState;
  onPatch: (next: Partial<PhotoLibraryFilterState>) => void;
  onDatePreset: (preset: PhotoLibraryDatePreset) => void;
  onClose: () => void;
}

export function PhotoLibraryFilterDropdown({
  filters,
  onPatch,
  onDatePreset,
  onClose,
}: PhotoLibraryFilterDropdownProps) {
  const datePreset = datePresetFromFilters(filters);

  return (
    <div className="space-y-6">
      <div>
        <p className={labelClass}>Date range</p>
        <HorizontalButtonSlider
          items={DATE_PRESET_ITEMS}
          value={datePreset}
          onChange={(id) => onDatePreset(id as PhotoLibraryDatePreset)}
          variant="segmented"
          dense
          aria-label="Photo date range"
          className="w-full"
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

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>PO #</span>
          <input
            className={fieldClass}
            value={filters.poRef ?? ''}
            onChange={(e) => onPatch({ poRef: e.target.value || undefined })}
            placeholder="4421"
          />
        </label>
        <label className="block">
          <span className={labelClass}>Receiving ID</span>
          <input
            className={fieldClass}
            aria-label="Receiving ID"
            value={filters.receivingId ?? ''}
            onChange={(e) => onPatch({ receivingId: e.target.value || undefined })}
            placeholder="1987"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Entity</span>
          <select
            className={fieldClass}
            aria-label="Entity"
            value={filters.entityType ?? ''}
            onChange={(e) => onPatch({ entityType: e.target.value || undefined })}
          >
            <option value="">Any</option>
            {Object.entries(PHOTO_ENTITY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Entity ID</span>
          <input
            className={fieldClass}
            aria-label="Entity ID"
            value={filters.entityId ?? ''}
            onChange={(e) => onPatch({ entityId: e.target.value || undefined })}
            placeholder="Unit / line id"
          />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Staff ID</span>
        <input
          className={fieldClass}
          value={filters.staffId ?? ''}
          onChange={(e) => onPatch({ staffId: e.target.value || undefined })}
          placeholder="Taken by staff"
        />
      </label>

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
