'use client';

import { useEffect, useState } from 'react';
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
import { Button } from '@/design-system/primitives';

const DATE_PRESET_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All', icon: Calendar },
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'yesterday', label: 'Yesterday', icon: History },
  { id: 'last7', label: '7d', icon: Calendar },
  { id: 'custom', label: 'Custom', icon: Calendar },
];

const fieldClass =
  'h-10 w-full rounded-xl border border-gray-100 bg-gray-50/50 px-3 text-caption font-bold text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';
const labelClass = 'mb-1.5 block text-caption font-black uppercase tracking-[0.2em] text-gray-400';

/**
 * A business-ID text field that commits to the URL on blur / Enter (not every
 * keystroke) so a long scan doesn't fire a refetch per character. Re-seeds from
 * the URL value when it changes elsewhere (chip removal, clear-all).
 */
function IdField({
  label,
  value,
  placeholder,
  numeric,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  placeholder?: string;
  numeric?: boolean;
  onCommit: (next: string | undefined) => void;
}) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => {
    setLocal(value ?? '');
  }, [value]);
  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === (value ?? '')) return;
    onCommit(trimmed || undefined);
  };
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input
        type="text"
        inputMode={numeric ? 'numeric' : undefined}
        className={fieldClass}
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

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
          <p className="truncate text-caption font-semibold text-gray-500">{dateRangeLabel}</p>
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

      <div className="space-y-3">
        <p className={labelClass}>Business IDs</p>
        <div className="grid grid-cols-2 gap-3">
          <IdField
            label="PO / Order #"
            value={filters.poRef}
            placeholder="PO-12345"
            onCommit={(v) => onPatch({ poRef: v })}
          />
          <IdField
            label="Tracking #"
            value={filters.tracking}
            placeholder="1Z… / 92…"
            onCommit={(v) => onPatch({ tracking: v })}
          />
          <IdField
            label="Serial #"
            value={filters.serial}
            placeholder="Serial number"
            onCommit={(v) => onPatch({ serial: v })}
          />
          <IdField
            label="SKU #"
            value={filters.sku}
            placeholder="Catalog SKU"
            onCommit={(v) => onPatch({ sku: v })}
          />
          <IdField
            label="Claim ticket #"
            value={filters.ticketId}
            placeholder="Zendesk #"
            numeric
            onCommit={(v) => onPatch({ ticketId: v })}
          />
          <IdField
            label="Local pickup #"
            value={filters.pickupId}
            placeholder="Pickup order"
            numeric
            onCommit={(v) => onPatch({ pickupId: v })}
          />
          <IdField
            label="Returns RMA #"
            value={filters.rma}
            placeholder="RMA number"
            onCommit={(v) => onPatch({ rma: v })}
          />
          <IdField
            label="Receiving ID"
            value={filters.receivingId}
            placeholder="Receiving #"
            numeric
            onCommit={(v) => onPatch({ receivingId: v })}
          />
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
