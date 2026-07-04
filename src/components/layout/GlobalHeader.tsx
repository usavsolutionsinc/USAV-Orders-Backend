'use client';

import { usePathname } from 'next/navigation';
import { useHeader } from '@/contexts/HeaderContext';
import { useAuth, isClientPublicPath } from '@/contexts/AuthContext';
import { GlobalHeaderActions } from './GlobalHeaderActions';
import { HeaderGoalChip } from './HeaderGoalChip';
// P1-WORK-01 (shared header): additive top-priority work-order chip.
import { HeaderTopWorkOrderChip } from './HeaderTopWorkOrderChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

/**
 * Global desktop header — one persistent bar mounted once in
 * {@link ResponsiveLayout}, above the page's `<main>`.
 *
 * Two zones:
 *   - **Left / center (contextual):** whatever the active page pushes through
 *     {@link useHeader} / {@link usePageHeader} — title, "Select" toggle,
 *     filters, bulk-action triggers. Empty on pages that don't set it.
 *   - **Right (persistent):** {@link GlobalHeaderActions} — search, notifications,
 *     staff switcher, account. Identical on every page.
 *
 * Mobile keeps its own chrome (MobileAppHeader); this bar is desktop-only.
 */
interface GlobalHeaderProps {
  /** True on routes that render the permanent desktop sidebar (everything but
   *  /operations) — gates the collapse toggle. */
  canCollapseSidebar?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function GlobalHeader({
  canCollapseSidebar = false,
  sidebarCollapsed = false,
  onToggleSidebar,
}: GlobalHeaderProps = {}) {
  const { panelContent } = useHeader();
  const { user } = useAuth();
  const pathname = usePathname();

  // Public / auth pages (signin, enroll, offline) render no app chrome — even
  // mid-sign-in, when refreshAuth() has already committed `user` but the hard
  // navigation off /signin hasn't unloaded the page yet. Without the path check
  // the bar flashes in over the sign-in splash during that window.
  if (!user || isClientPublicPath(pathname)) return null;

  return (
    <header className="sticky top-0 z-header flex h-[40px] w-full shrink-0 select-none items-center gap-3 border-b border-border-default bg-surface-card/90 px-3 backdrop-blur-md sm:px-4">
      {/* Top-left sidebar toggle — collapses / restores the permanent sidebar. */}
      {canCollapseSidebar && onToggleSidebar && (
        <>
          <HoverTooltip label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} asChild>
            <IconButton
              onClick={onToggleSidebar}
              ariaLabel={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-pressed={!sidebarCollapsed}
              /* Nudged slightly right of the flush content edge. */
              className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken active:bg-surface-strong sm:-ml-1.5"
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              }
            />
          </HoverTooltip>
          {/* Hairline divider between the sidebar toggle and the goal chip. */}
          <span aria-hidden className="h-5 w-px shrink-0 bg-surface-strong" />
        </>
      )}

      {/* Daily goal — pinned right of the sidebar toggle, persistent across pages. */}
      <HeaderGoalChip />

      {/* Top-priority work order for the signed-in operator (P1-WORK-01).
          Renders nothing when there's no actionable assigned work. */}
      <HeaderTopWorkOrderChip />

      {/* Contextual zone — fed per page via useHeader()/usePageHeader(). */}
      <div className="flex min-w-0 flex-1 items-center">{panelContent}</div>

      {/* Persistent zone — same on every page. */}
      <GlobalHeaderActions />
    </header>
  );
}
