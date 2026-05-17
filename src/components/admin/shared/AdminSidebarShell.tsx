'use client';

import type { ReactNode } from 'react';

interface AdminSidebarShellProps {
  search?: ReactNode;
  filters?: ReactNode;
  stats?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function AdminSidebarShell({
  search,
  filters,
  stats,
  action,
  children,
}: AdminSidebarShellProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {search ? (
        <div className="flex-shrink-0 border-b border-gray-200 px-3 py-3">{search}</div>
      ) : null}
      {filters ? (
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-gray-200 px-3 py-2">
          {filters}
        </div>
      ) : null}
      {stats ? (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-200 px-3 py-2">
          {stats}
        </div>
      ) : null}
      {action ? (
        <div className="flex-shrink-0 border-b border-gray-200 px-3 py-2.5">{action}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
    </div>
  );
}
