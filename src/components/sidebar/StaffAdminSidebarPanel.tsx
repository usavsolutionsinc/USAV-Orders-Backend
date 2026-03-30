'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';

const STAFF_VIEW_OPTIONS = [
  { value: 'all', label: 'All Staff' },
  { value: 'active', label: 'Active Only' },
  { value: 'inactive', label: 'Inactive Only' },
  { value: 'technician', label: 'Technicians' },
  { value: 'packer', label: 'Packers' },
] as const;

type StaffViewMode = (typeof STAFF_VIEW_OPTIONS)[number]['value'];

function emitOpenAddStaff() {
  window.dispatchEvent(new CustomEvent('admin-staff-open-add'));
}

export function StaffAdminSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';
  const staffView = (searchParams.get('staffView') as StaffViewMode) || 'all';

  const updateParams = (patch: { search?: string; staffView?: StaffViewMode }) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'staff');

    if (patch.search !== undefined) {
      const value = patch.search.trim();
      if (value) nextParams.set('search', value);
      else nextParams.delete('search');
    }

    if (patch.staffView !== undefined) {
      if (patch.staffView === 'all') nextParams.delete('staffView');
      else nextParams.set('staffView', patch.staffView);
    }

    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  const clearFilters = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'staff');
    nextParams.delete('search');
    nextParams.delete('staffView');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200">
        <ViewDropdown
          options={STAFF_VIEW_OPTIONS}
          value={staffView}
          onChange={(nextValue) => updateParams({ staffView: nextValue as StaffViewMode })}
          variant="boxy"
          buttonClassName={`h-full w-full appearance-none bg-white px-4 py-3 pr-8 text-left ${fieldLabel} outline-none transition-all hover:bg-gray-50`}
          optionClassName={fieldLabel}
        />
      </div>

      <div className="border-b border-gray-200 px-3 py-3">
        <SearchBar
          value={searchValue}
          onChange={(value) => updateParams({ search: value })}
          onClear={() => updateParams({ search: '' })}
          placeholder="Search name or ID"
          variant="blue"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={emitOpenAddStaff}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className={dataValue}>Add Team Member</p>
            <p className={`mt-0.5 ${fieldLabel} text-gray-500`}>Open the form to create a new staff record</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={clearFilters}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className={dataValue}>Clear Filters</p>
            <p className={`mt-0.5 ${fieldLabel} text-gray-500`}>Reset search and staff view</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </div>
  );
}
