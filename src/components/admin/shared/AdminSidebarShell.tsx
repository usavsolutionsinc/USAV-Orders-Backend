'use client';

import type { ReactNode } from 'react';
import { SidebarShell, type SidebarShellSearch } from '@/components/layout/SidebarShell';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';

interface AdminSidebarShellProps {
  search?: SidebarShellSearch;
  filters?: ReactNode;
  stats?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Admin sidebar layout — now a thin wrapper over the house {@link SidebarShell}.
 *
 * Every admin panel shares the SAME flush 40px search band, gutter
 * ({@link SIDEBAR_GUTTER}), and scroll-body structure as every other sidebar.
 * Panels pass search PROPS (not a `<SearchBar>` node); the shell renders
 * `<SidebarSearchBar>` so the input height is locked and can't drift. The
 * `filters` / `stats` / `action` slots are pinned, bordered rows below the
 * search (rendered outside the scroll body so they stay put).
 */
export function AdminSidebarShell({
  search,
  filters,
  stats,
  action,
  children,
}: AdminSidebarShellProps) {
  return (
    <SidebarShell
      className="bg-white"
      search={search}
      headerBelow={
        filters || stats || action ? (
          <>
            {filters ? (
              <div className={`flex items-center gap-1.5 border-b border-gray-200 ${SIDEBAR_GUTTER} py-2`}>
                {filters}
              </div>
            ) : null}
            {stats ? (
              <div className={`flex flex-wrap items-center gap-1.5 border-b border-gray-200 ${SIDEBAR_GUTTER} py-2`}>
                {stats}
              </div>
            ) : null}
            {action ? (
              <div className={`border-b border-gray-200 ${SIDEBAR_GUTTER} py-2.5`}>{action}</div>
            ) : null}
          </>
        ) : null
      }
      bodyClassName="py-2"
    >
      {children}
    </SidebarShell>
  );
}
