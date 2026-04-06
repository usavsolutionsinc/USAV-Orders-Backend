'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { RefreshCw, X } from '@/components/Icons';
import { sectionLabel, dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';

const GOAL_VIEW_OPTIONS = [
  { value: 'all', label: 'All Staff' },
  { value: 'behind', label: 'Below 70%' },
  { value: 'on-track', label: '70% - 99%' },
  { value: 'exceeded', label: '100%+' },
] as const;

type GoalViewMode = (typeof GOAL_VIEW_OPTIONS)[number]['value'];

function emitGoalsRefresh() {
  window.dispatchEvent(new CustomEvent('admin-goals-refresh'));
}

export function GoalsSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';
  const goalView = (searchParams.get('goalView') as GoalViewMode) || 'all';

  const updateParams = (patch: { search?: string; goalView?: GoalViewMode }) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'goals');

    if (patch.search !== undefined) {
      const value = patch.search.trim();
      if (value) nextParams.set('search', value);
      else nextParams.delete('search');
    }

    if (patch.goalView !== undefined) {
      if (patch.goalView === 'all') nextParams.delete('goalView');
      else nextParams.set('goalView', patch.goalView);
    }

    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  const clearFilters = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'goals');
    nextParams.delete('search');
    nextParams.delete('goalView');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200">
        <ViewDropdown
          options={GOAL_VIEW_OPTIONS}
          value={goalView}
          onChange={(nextValue) => updateParams({ goalView: nextValue as GoalViewMode })}
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
          placeholder="Search staff or role"
          variant="blue"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-gray-200 px-4 py-3">
          <p className={sectionLabel}>Goal Tools</p>
        </div>

        <button
          type="button"
          onClick={emitGoalsRefresh}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className={dataValue}>Refresh Goal Data</p>
            <p className={`mt-0.5 ${fieldLabel} text-gray-500`}>Reload counts and saved daily goals</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <RefreshCw className="h-3.5 w-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={clearFilters}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className={dataValue}>Clear Filters</p>
            <p className={`mt-0.5 ${fieldLabel} text-gray-500`}>Reset search and goal view</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </div>
  );
}
