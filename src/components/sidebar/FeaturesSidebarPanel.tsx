'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';

const FEATURE_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'feature', label: 'Features' },
  { value: 'bug_fix', label: 'Bug Fixes' },
] as const;

const FEATURE_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
] as const;

const FEATURE_ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active Only' },
  { value: 'all', label: 'Active + Hidden' },
  { value: 'false', label: 'Hidden Only' },
] as const;

type FeatureTypeFilter = (typeof FEATURE_TYPE_OPTIONS)[number]['value'];
type FeatureStatusFilter = (typeof FEATURE_STATUS_OPTIONS)[number]['value'];
type FeatureActiveFilter = (typeof FEATURE_ACTIVE_OPTIONS)[number]['value'];

function emitOpenAddFeature() {
  window.dispatchEvent(new CustomEvent('admin-features-open-add'));
}

export function FeaturesSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';
  const featureType = (searchParams.get('featureType') as FeatureTypeFilter) || 'all';
  const featureStatus = (searchParams.get('featureStatus') as FeatureStatusFilter) || 'all';
  const featureActive = (searchParams.get('featureActive') as FeatureActiveFilter) || 'true';

  const updateParams = (patch: {
    search?: string;
    featureType?: FeatureTypeFilter;
    featureStatus?: FeatureStatusFilter;
    featureActive?: FeatureActiveFilter;
  }) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'features');

    if (patch.search !== undefined) {
      const value = patch.search.trim();
      if (value) nextParams.set('search', value);
      else nextParams.delete('search');
    }

    if (patch.featureType !== undefined) {
      if (patch.featureType === 'all') nextParams.delete('featureType');
      else nextParams.set('featureType', patch.featureType);
    }

    if (patch.featureStatus !== undefined) {
      if (patch.featureStatus === 'all') nextParams.delete('featureStatus');
      else nextParams.set('featureStatus', patch.featureStatus);
    }

    if (patch.featureActive !== undefined) {
      if (patch.featureActive === 'true') nextParams.delete('featureActive');
      else nextParams.set('featureActive', patch.featureActive);
    }

    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin?section=features');
  };

  const clearFilters = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'features');
    nextParams.delete('search');
    nextParams.delete('featureType');
    nextParams.delete('featureStatus');
    nextParams.delete('featureActive');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin?section=features');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200">
        <ViewDropdown
          options={FEATURE_TYPE_OPTIONS}
          value={featureType}
          onChange={(nextValue) => updateParams({ featureType: nextValue as FeatureTypeFilter })}
          variant="boxy"
          buttonClassName="h-full w-full appearance-none bg-white px-4 py-3 pr-8 text-left text-[10px] font-black uppercase tracking-wider text-gray-700 outline-none transition-all hover:bg-gray-50"
          optionClassName="text-[10px] font-black tracking-wider"
        />
      </div>

      <div className="border-b border-gray-200">
        <ViewDropdown
          options={FEATURE_STATUS_OPTIONS}
          value={featureStatus}
          onChange={(nextValue) => updateParams({ featureStatus: nextValue as FeatureStatusFilter })}
          variant="boxy"
          buttonClassName="h-full w-full appearance-none bg-white px-4 py-3 pr-8 text-left text-[10px] font-black uppercase tracking-wider text-gray-700 outline-none transition-all hover:bg-gray-50"
          optionClassName="text-[10px] font-black tracking-wider"
        />
      </div>

      <div className="border-b border-gray-200">
        <ViewDropdown
          options={FEATURE_ACTIVE_OPTIONS}
          value={featureActive}
          onChange={(nextValue) => updateParams({ featureActive: nextValue as FeatureActiveFilter })}
          variant="boxy"
          buttonClassName="h-full w-full appearance-none bg-white px-4 py-3 pr-8 text-left text-[10px] font-black uppercase tracking-wider text-gray-700 outline-none transition-all hover:bg-gray-50"
          optionClassName="text-[10px] font-black tracking-wider"
        />
      </div>

      <div className="border-b border-gray-200 px-3 py-3">
        <SearchBar
          value={searchValue}
          onChange={(value) => updateParams({ search: value })}
          onClear={() => updateParams({ search: '' })}
          placeholder="Search title or page"
          variant="gray"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={emitOpenAddFeature}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className="text-[11px] font-black tracking-widest text-gray-900">Add Work Item</p>
            <p className="mt-0.5 text-[10px] font-bold text-gray-500">Create a feature or bug fix entry</p>
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
            <p className="text-[11px] font-black tracking-widest text-gray-900">Clear Filters</p>
            <p className="mt-0.5 text-[10px] font-bold text-gray-500">Reset search and feature views</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </div>
  );
}
