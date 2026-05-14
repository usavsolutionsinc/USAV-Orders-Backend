'use client';

import type { ReactNode } from 'react';
import { Menu } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';

export interface AppTopBarProps {
  title: string;
  onOpenDrawer: () => void;
  trailing?: ReactNode;
  className?: string;
}

/**
 * Global mobile top app bar — [☰] [title (centered)] [trailing slot].
 *
 * Uses a 3-column grid (44px / 1fr / 44px) so the hamburger and the title
 * line up on the same baseline regardless of title length. The grid mirrors
 * the previous `MobileDefaultTopBanner` so visual weight feels consistent.
 */
export function AppTopBar({ title, onOpenDrawer, trailing, className }: AppTopBarProps) {
  return (
    <header
      className={cn(
        sidebarHeaderBandClass,
        'pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      <div className="grid w-full min-h-[44px] grid-cols-[44px_minmax(0,1fr)_44px] items-stretch">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Open app navigation"
          className="flex h-full w-full items-center justify-center bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex h-full min-w-0 items-center justify-center bg-white px-3">
          <span className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-gray-700">
            {title}
          </span>
        </div>

        <div className="flex h-full w-full items-stretch bg-white">{trailing}</div>
      </div>
    </header>
  );
}
