'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from '@/components/Icons';
import { GlobalHeaderActions } from '@/components/layout/GlobalHeaderActions';
import { HeaderGoalChip } from '@/components/layout/HeaderGoalChip';

/**
 * Shared top bar for every primary mobile page (/m/home, /m/receiving,
 * /m/scan, /m/receive, /m/pick, /m/pack).
 *
 * Deliberately title-less: mobile pages never show a page title in the top-left.
 * The daily-goal chip is pinned to the far left on EVERY mobile page (it
 * self-hides when the staffer has no station goals); the global controls
 * (inbox + account FAB) sit on the right, with an optional back button left.
 *
 * Full-bleed by design — render it as a direct child at the top of the page,
 * before any padded body wrapper, so it sticks to the top of the scroll
 * container.
 */
export const MobileTopBar = ({
  onBack,
  actions,
}: {
  /** When provided, renders a back button on the far left. */
  onBack?: () => void;
  /** Page-specific controls, placed left of the global actions. */
  actions?: ReactNode;
}) => (
  <header className="sticky top-0 z-30 flex w-full shrink-0 items-center justify-between gap-2 border-b border-blue-100/50 bg-slate-50/90 px-4 py-2.5 backdrop-blur-xl">
    <div className="flex min-w-0 items-center gap-2">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-white text-blue-500 shadow-sm transition-all active:scale-90"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {/* Daily-goal chip pinned to the far left of every mobile page. */}
      <HeaderGoalChip />
    </div>

    <div className="flex shrink-0 items-center gap-2">
      {actions}
      <GlobalHeaderActions variant="mobile" />
    </div>
  </header>
);
