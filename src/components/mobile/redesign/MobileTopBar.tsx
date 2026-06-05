'use client';

import type { ComponentType, ReactNode } from 'react';
import { ChevronLeft } from '@/components/Icons';
import { GlobalHeaderActions } from '@/components/layout/GlobalHeaderActions';
import { HeaderGoalChip } from '@/components/layout/HeaderGoalChip';

/**
 * Shared top bar for every primary mobile page (/m/home, /m/receiving,
 * /m/scan, /m/receive, /m/pick) so the header is identical across the app
 * instead of each page hand-rolling its own app bar.
 *
 * Layout is always:
 *   [back | icon tile]  Eyebrow / Title          [page actions] [goal] [global]
 *
 * The right zone always ends with {@link GlobalHeaderActions} (the inbox +
 * account FAB) so the global controls follow the user onto every page. Pages
 * pass their own `actions` (e.g. a refresh button) which sit to the left of the
 * global controls. `showGoal` adds the daily-goal ring chip (dashboard).
 *
 * Full-bleed by design — render it as a direct child at the top of the page,
 * BEFORE any horizontally-padded body wrapper, so it spans edge to edge and
 * sticks to the top of the scroll container.
 */
export const MobileTopBar = ({
  title,
  eyebrow,
  icon: Icon,
  onBack,
  actions,
  showGoal = false,
}: {
  title: string;
  eyebrow?: string;
  icon?: ComponentType<{ className?: string }>;
  /** When provided, renders a back button on the far left instead of the icon tile. */
  onBack?: () => void;
  /** Page-specific controls, placed left of the global actions. */
  actions?: ReactNode;
  /** Show the daily-goal ring chip (used on the dashboard). */
  showGoal?: boolean;
}) => (
  <header className="sticky top-0 z-30 flex w-full shrink-0 items-center justify-between gap-2 border-b border-blue-100/50 bg-slate-50/90 px-4 py-2.5 backdrop-blur-xl">
    <div className="flex min-w-0 items-center gap-3">
      {onBack ? (
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-white text-blue-500 shadow-sm transition-all active:scale-90"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : Icon ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[10px] font-black uppercase leading-none tracking-[0.18em] text-blue-400">
            {eyebrow}
          </p>
        )}
        <p className="mt-0.5 truncate text-base font-black leading-tight tracking-tight text-blue-950">
          {title}
        </p>
      </div>
    </div>

    <div className="flex shrink-0 items-center gap-2">
      {actions}
      {showGoal && <HeaderGoalChip />}
      <GlobalHeaderActions variant="mobile" />
    </div>
  </header>
);

export default MobileTopBar;
