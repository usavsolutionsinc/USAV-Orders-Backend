'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';

function emitOpenAddFba() {
  window.dispatchEvent(new CustomEvent('admin-fba-open-add'));
}

function emitOpenUploadFba() {
  window.dispatchEvent(new CustomEvent('admin-fba-open-upload'));
}

export function AdminFbaSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';

  const updateSearch = (value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'fba');
    if (value.trim()) nextParams.set('search', value.trim());
    else nextParams.delete('search');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  const clearFilters = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'fba');
    nextParams.delete('search');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200 px-3 py-3">
        <SearchBar
          value={searchValue}
          onChange={updateSearch}
          onClear={() => updateSearch('')}
          placeholder="Search ASIN, SKU, FNSKU..."
          variant="blue"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={emitOpenAddFba}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className="text-[11px] font-black tracking-widest text-gray-900">Add FNSKU Row</p>
            <p className="mt-0.5 text-[10px] font-bold text-gray-500">Open manual entry for a single SKU</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={emitOpenUploadFba}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className="text-[11px] font-black tracking-widest text-gray-900">Upload CSV</p>
            <p className="mt-0.5 text-[10px] font-bold text-gray-500">Import bulk FNSKU mappings</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 0-4 4m4-4 4 4M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
            </svg>
          </span>
        </button>

        <button
          type="button"
          onClick={clearFilters}
          className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <div>
            <p className="text-[11px] font-black tracking-widest text-gray-900">Clear Search</p>
            <p className="mt-0.5 text-[10px] font-bold text-gray-500">Reset the current FBA query</p>
          </div>
          <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </div>
  );
}
