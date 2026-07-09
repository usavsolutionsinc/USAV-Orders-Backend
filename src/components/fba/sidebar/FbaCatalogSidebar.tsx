'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { emitOpenAddFba, emitOpenUploadFba, sidebarSubBandClass } from '@/components/fba/sidebar/fba-sidebar-shared';

/** Suspense fallback for the admin FNSKU catalog sidebar. */
export function FbaCatalogSidebarFallback() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface-card">
      <div className={`${sidebarSubBandClass} ${SIDEBAR_GUTTER} py-2.5`}>
        <div className="h-4 w-24 bg-surface-sunken rounded mb-2 animate-pulse" />
        <div className="h-10 w-full rounded-xl bg-surface-sunken animate-pulse" />
      </div>
      <div className={`min-h-0 flex-1 space-y-4 ${SIDEBAR_GUTTER} py-3`}>
        <div className="h-4 w-32 bg-surface-sunken rounded animate-pulse" />
        <div className="space-y-2">
          <div className="h-14 w-full rounded-xl bg-surface-canvas border border-border-hairline animate-pulse" />
          <div className="h-14 w-full rounded-xl bg-surface-canvas border border-border-hairline animate-pulse" />
          <div className="h-14 w-full rounded-xl bg-surface-canvas border border-border-hairline animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/**
 * Admin FNSKU catalog tools (/admin?section=fba): catalog search plus the
 * add-row / upload-CSV / clear-search actions and a link to the FBA station.
 */
export function FbaCatalogSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';

  const pushAdminParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('section', 'fba');
      mutate(next);
      const q = next.toString();
      router.replace(q ? `/admin?${q}` : '/admin');
    },
    [router, searchParams],
  );

  const updateSearch = (value: string) => {
    pushAdminParams((p) => {
      if (value.trim()) p.set('search', value.trim());
      else p.delete('search');
    });
  };

  const clearFilters = () => {
    pushAdminParams((p) => {
      p.delete('search');
    });
  };

  const actionRowClass =
    'flex w-full items-center justify-between gap-2 rounded-lg border border-border-soft bg-surface-canvas px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface-card">
      <div className={`${sidebarSubBandClass} ${SIDEBAR_GUTTER} py-2.5`}>
        <p className="mb-2 text-micro font-semibold uppercase tracking-widest text-text-soft">
          Catalog search
        </p>
        <SearchBar
          value={searchValue}
          onChange={updateSearch}
          onClear={() => updateSearch('')}
          placeholder="Search ASIN, SKU, or FNSKU"
          variant="blue"
          className="w-full"
        />
      </div>

      <div className={`min-h-0 flex-1 space-y-2 overflow-y-auto ${SIDEBAR_GUTTER} py-3`}>
        <p className="text-micro font-semibold uppercase tracking-widest text-text-soft">Catalog actions</p>

        {/* ds-raw-button */}
        <button type="button" onClick={emitOpenAddFba} className={actionRowClass}>
          <span>
            <span className="block text-xs font-bold text-text-default">Add Catalog Row</span>
            <span className="mt-0.5 block text-caption text-text-soft">Create one FNSKU mapping manually</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface-card text-text-muted">
            <Plus className="h-4 w-4" />
          </span>
        </button>

        {/* ds-raw-button */}
        <button type="button" onClick={emitOpenUploadFba} className={actionRowClass}>
          <span>
            <span className="block text-xs font-bold text-text-default">Upload CSV</span>
            <span className="mt-0.5 block text-caption text-text-soft">Import many FNSKU mappings from a file</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface-card text-text-muted">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 16V4m0 0-4 4m4-4 4 4M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"
              />
            </svg>
          </span>
        </button>

        {/* ds-raw-button */}
        <button type="button" onClick={clearFilters} className={actionRowClass}>
          <span>
            <span className="block text-xs font-bold text-text-default">Clear search</span>
            <span className="mt-0.5 block text-caption text-text-soft">Reset the current catalog search</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface-card text-text-muted">
            <X className="h-4 w-4" />
          </span>
        </button>
      </div>

      <div className={`${sidebarSubBandClass} mt-auto ${SIDEBAR_GUTTER} py-3`}>
        <p className="text-micro font-semibold uppercase tracking-widest text-text-soft">FBA Station</p>
        <Link
          href="/fba"
          className="mt-2 flex w-full items-center justify-center rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900 transition-colors hover:bg-violet-100"
        >
          Open FBA Station
        </Link>
      </div>
    </div>
  );
}
